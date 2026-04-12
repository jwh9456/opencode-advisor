/**
 * opencode-advisor plugin
 *
 * Claude native advisor API를 재현하는 것이 아니라,
 * opencode 플러그인 레이어에서 더 강한 모델에게 전략 자문을 구하는
 * explicit advisor tool을 제공한다.
 */

import { type Plugin, type ToolContext, tool } from "@opencode-ai/plugin"
import { readFileSync } from "fs"
import { join } from "path"

type AdvisorConfig = {
  /** "provider/model" 형식. null 이면 fork된 세션의 기본 모델 사용 */
  advisorModel: string | null
  /** advisor 세션에 주입할 시스템 프롬프트. null 이면 기본값 사용 */
  advisorSystem: string | null
  /** 대화 레벨 최대 advisor 호출 횟수. 0 = 무제한 */
  maxAdvisorCalls: number
  /** 디버그 로그 활성화 */
  debug: boolean
}

type PluginContext = Parameters<Plugin>[0]
type OpencodeClient = PluginContext["client"]
type SessionForkResult = Awaited<ReturnType<OpencodeClient["session"]["fork"]>>
type SessionPromptResult = Awaited<ReturnType<OpencodeClient["session"]["prompt"]>>
type SessionPromptData = NonNullable<SessionPromptResult["data"]>
type SessionPromptPart = SessionPromptData["parts"][number]

type ParsedModel = {
  providerID: string
  modelID: string
}

type RequestErrorLike = {
  data?: {
    message?: string
  }
}

type AdvisorArgs = {
  question: string
  context?: string
}

const DEFAULT_ADVISOR_SYSTEM =
  `You are a strategic advisor helping another coding agent.\n` +
  `Return concise advice only. Do not call tools. Do not write code unless it is essential to clarify a plan.\n` +
  `Prefer numbered steps. Keep the answer under 100 words when possible.`

const DEFAULT_CONFIG: AdvisorConfig = {
  advisorModel: null,
  advisorSystem: null,
  maxAdvisorCalls: 0,
  debug: false,
}

const _advisorCallCounts = new Map<string, number>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizeConfig(value: unknown): AdvisorConfig {
  if (!isRecord(value)) return { ...DEFAULT_CONFIG }

  return {
    advisorModel: typeof value.advisorModel === "string" ? value.advisorModel : DEFAULT_CONFIG.advisorModel,
    advisorSystem:
      typeof value.advisorSystem === "string"
        ? value.advisorSystem
        : value.advisorSystem === null
          ? null
          : DEFAULT_CONFIG.advisorSystem,
    maxAdvisorCalls:
      typeof value.maxAdvisorCalls === "number" && value.maxAdvisorCalls >= 0
        ? value.maxAdvisorCalls
        : DEFAULT_CONFIG.maxAdvisorCalls,
    debug: typeof value.debug === "boolean" ? value.debug : DEFAULT_CONFIG.debug,
  }
}

function parseModelString(value: string | null): ParsedModel | undefined {
  if (!value) return undefined
  const [providerID, ...rest] = value.split("/")
  const modelID = rest.join("/")
  if (!providerID || !modelID) return undefined
  return { providerID, modelID }
}

export function buildAdvisorPrompt(args: AdvisorArgs): string {
  const blocks = [
    `Question:\n${args.question.trim()}`,
  ]

  if (args.context?.trim()) {
    blocks.push(`Context:\n${args.context.trim()}`)
  }

  blocks.push("Return concise strategic advice for the calling agent.")
  return blocks.join("\n\n")
}

export function extractText(parts: SessionPromptPart[] | undefined): string {
  if (!parts?.length) return ""
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n")
    .trim()
}

function requestErrorMessage(error: RequestErrorLike | unknown): string {
  if (!error) return "unknown error"
  if (typeof error === "object" && error !== null) {
    const candidate = error as RequestErrorLike
    if (candidate.data?.message) return candidate.data.message
  }
  return String(error)
}

function hasData<T extends { data?: unknown }>(result: T): result is T & { data: Exclude<T["data"], undefined> } {
  return result.data !== undefined
}

function getAdvisorCallCount(sessionId: string): number {
  return _advisorCallCounts.get(sessionId) ?? 0
}

function incrementAdvisorCallCount(sessionId: string): number {
  const next = getAdvisorCallCount(sessionId) + 1
  _advisorCallCounts.set(sessionId, next)
  return next
}

export function resetAdvisorCounter(sessionId?: string): void {
  if (sessionId !== undefined) {
    _advisorCallCounts.delete(sessionId)
    return
  }
  _advisorCallCounts.clear()
}

export function loadConfig(dir: string): AdvisorConfig {
  const path = join(dir, ".opencode", "plugins", "advisor-config.json")
  let cfg: AdvisorConfig

  try {
    const raw = readFileSync(path, "utf-8")
    cfg = normalizeConfig(JSON.parse(raw) as unknown)
  } catch {
    cfg = { ...DEFAULT_CONFIG }
  }

  if (process.env.ADVISOR_MODEL) cfg.advisorModel = process.env.ADVISOR_MODEL
  if (process.env.ADVISOR_SYSTEM !== undefined) {
    cfg.advisorSystem = process.env.ADVISOR_SYSTEM.trim() ? process.env.ADVISOR_SYSTEM : null
  }
  if (process.env.ADVISOR_DEBUG === "true") cfg.debug = true
  if (process.env.ADVISOR_MAX_CALLS !== undefined) {
    const n = parseInt(process.env.ADVISOR_MAX_CALLS, 10)
    if (!isNaN(n) && n >= 0) cfg.maxAdvisorCalls = n
  }

  return cfg
}

export function parseModel(value: string | null): ParsedModel | undefined {
  return parseModelString(value)
}

export function createAdvisorTool(pluginCtx: PluginContext, cfg: AdvisorConfig, advisorSessionIDs: Set<string>) {
  return tool({
    description:
      "Consult a stronger advisor model for strategic guidance before choosing an approach, when stuck, or before finishing.",
    args: {
      question: tool.schema.string().describe("The specific question or decision that needs guidance."),
      context: tool.schema.string().optional().describe("Optional supporting context, evidence, or constraints."),
    },
    execute: async (args: AdvisorArgs, toolCtx: ToolContext) => {
      if (advisorSessionIDs.has(toolCtx.sessionID)) {
        return "[advisor unavailable: recursive advisor call blocked]"
      }

      if (toolCtx.abort.aborted) {
        return "[advisor unavailable: request aborted]"
      }

      if (cfg.maxAdvisorCalls > 0) {
        const callCount = getAdvisorCallCount(toolCtx.sessionID)
        if (callCount >= cfg.maxAdvisorCalls) {
          return `[advisor unavailable: budget exhausted (${cfg.maxAdvisorCalls} calls)]`
        }
      }

      const model = parseModelString(cfg.advisorModel)
      const system = cfg.advisorSystem ?? DEFAULT_ADVISOR_SYSTEM
      const prompt = buildAdvisorPrompt(args)
      let advisorSessionId: string | undefined

      try {
        toolCtx.metadata({ title: "Consulting advisor" })

        const forkResult: SessionForkResult = await pluginCtx.client.session.fork({
          path: { id: toolCtx.sessionID },
          body: { messageID: toolCtx.messageID },
        })

        if (!hasData(forkResult)) {
          const message = requestErrorMessage(forkResult.error)
          if (cfg.debug) {
            console.error(`[opencode-advisor] failed to fork session: ${message}`)
          }
          return `[advisor unavailable: failed to create advisor session (${message})]`
        }

        advisorSessionId = forkResult.data.id
        advisorSessionIDs.add(advisorSessionId)

        if (cfg.maxAdvisorCalls > 0) {
          incrementAdvisorCallCount(toolCtx.sessionID)
        }

        if (cfg.debug) {
          console.log(
            `[opencode-advisor] advisor tool called — parent=${toolCtx.sessionID} child=${advisorSessionId} model=${cfg.advisorModel ?? "inherit"}`,
          )
        }

        const promptBody: {
          model?: ParsedModel
          system: string
          tools: Record<string, boolean>
          parts: Array<{ type: "text"; text: string }>
        } = {
          system,
          tools: { advisor: false },
          parts: [{ type: "text", text: prompt }],
        }

        if (model) promptBody.model = model

        const promptResult: SessionPromptResult = await pluginCtx.client.session.prompt({
          path: { id: advisorSessionId },
          body: promptBody,
        })

        if (!hasData(promptResult)) {
          const message = requestErrorMessage(promptResult.error)
          if (cfg.debug) {
            console.error(`[opencode-advisor] advisor prompt failed: ${message}`)
          }
          return `[advisor unavailable: prompt failed (${message})]`
        }

        const text = extractText(promptResult.data.parts)
        if (!text) return "[advisor returned no text]"
        return text
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        if (cfg.debug) {
          console.error(`[opencode-advisor] advisor tool error: ${message}`)
        }
        return `[advisor unavailable: ${message}]`
      } finally {
        if (advisorSessionId) {
          advisorSessionIDs.delete(advisorSessionId)
          pluginCtx.client.session.delete({ path: { id: advisorSessionId } }).catch((error: unknown) => {
            if (!cfg.debug) return
            const message = error instanceof Error ? error.message : String(error)
            console.error(`[opencode-advisor] failed to delete advisor session: ${message}`)
          })
        }
      }
    },
  })
}

export const AdvisorPlugin: Plugin = async (pluginCtx) => {
  const cfg = loadConfig(pluginCtx.directory)
  const advisorSessionIDs = new Set<string>()

  if (cfg.debug) {
    console.log("[opencode-advisor] initialized")
    console.log(
      `[opencode-advisor] model: ${cfg.advisorModel ?? "inherit from forked session"}`,
    )
    console.log(`[opencode-advisor] maxAdvisorCalls: ${cfg.maxAdvisorCalls}`)
  }

  return {
    tool: {
      advisor: createAdvisorTool(pluginCtx, cfg, advisorSessionIDs),
    },

    event: async ({ event }) => {
      if (event.type !== "session.deleted") return
      const sessionId = event.properties.info.id
      resetAdvisorCounter(sessionId)
      advisorSessionIDs.delete(sessionId)
    },

    "experimental.chat.system.transform": async (input, output) => {
      if (input.sessionID && advisorSessionIDs.has(input.sessionID)) {
        if (cfg.debug) {
          output.system.push("[opencode-advisor] advisor child session")
        }
        return
      }

      output.system.push(
        `You have access to an \`advisor\` tool backed by a stronger model.\n` +
          `Call it BEFORE substantive work, when stuck, or before declaring done.\n` +
          `Pass a specific question and the relevant context.\n` +
          `The advisor returns concise strategic advice only and does not execute tools or produce the final deliverable.`,
      )

      if (!cfg.debug) return
      output.system.push(
        `[opencode-advisor] tool=advisor | model=${cfg.advisorModel ?? "inherit"} | maxCalls=${cfg.maxAdvisorCalls}`,
      )
    },
  }
}

export default {
  server: AdvisorPlugin,
}
