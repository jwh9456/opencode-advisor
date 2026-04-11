/**
 * opencode-advisor plugin
 *
 * 멀티 에이전트 환경에서 작업 성격에 따라 서브에이전트 유형(= 모델)을 라우팅한다.
 *
 * 라우팅 전략: advisor mode (default) | routing mode
 * - advisor: 기본 executor(balanced) + 모델 주도 에스컬레이션(powerful) + keyword guardrail
 * - routing: 프롬프트 키워드별 가중치 합산 + 토큰 볼륨 보너스로 3-tier 배정
 * - general에서 오는 호출만 라우팅, 전문 에이전트(explore, build 등)는 패스스루
 *
 * 구현 시나리오: B (우회 라우팅)
 * - tool.execute.before hook → output.args.subagent_type 속성 변경
 *
 * 근거: _workspace/01_explorer_findings.md, _workspace/02_scenario_decision.md
 */

import type { Plugin } from "@opencode-ai/plugin"
import { readFileSync, existsSync } from "fs"
import { join } from "path"

// ─── 모듈 1: 설정 로더 ───────────────────────────────────────────────────────

type TierName = "high" | "medium" | "low"

type AdvisorConfig = {
  mode: "advisor" | "routing"
  advisor: { defaultExecutor: string; advisorAgent: string }
  agents: { high: string; medium: string; low: string }
  keywords: Record<string, number>
  token_bonus: { threshold: number; weight: number }
  tiers: { high: number; medium: number }
  escalation: { keywords: string[]; forceTier: TierName }
  simplification: { keywords: string[]; forceTier: TierName }
  forceInherit: boolean
  debug: boolean
}

const DEFAULT_CONFIG: AdvisorConfig = {
  mode: "advisor",
  advisor: { defaultExecutor: "balanced", advisorAgent: "powerful" },
  agents: { high: "powerful", medium: "balanced", low: "fast" },
  keywords: {
    refactor: 5,
    architect: 5,
    design: 4,
    review: 3,
    implement: 3,
    create: 3,
    write: 2,
    fix: 2,
    debug: 2,
    read: -1,
    search: -2,
    find: -2,
    list: -1,
    check: -1,
    show: -1,
    what: -1,
    why: -1,
    how: -1,
    explain: -1,
  },
  token_bonus: { threshold: 2000, weight: 3 },
  tiers: { high: 5, medium: 1 },
  escalation: {
    keywords: ["critical", "production", "security", "breaking", "architecture"],
    forceTier: "high",
  },
  simplification: {
    keywords: ["find", "list", "show", "where", "search", "grep", "locate"],
    forceTier: "low",
  },
  forceInherit: false,
  debug: false,
}

function loadConfig(dir: string): AdvisorConfig {
  const path = join(dir, ".opencode", "plugins", "advisor-config.json")
  let cfg: AdvisorConfig
  try {
    const raw = readFileSync(path, "utf-8")
    const parsed = JSON.parse(raw) as Partial<AdvisorConfig>
    cfg = {
      mode: parsed.mode ?? DEFAULT_CONFIG.mode,
      advisor: parsed.advisor ?? DEFAULT_CONFIG.advisor,
      agents: parsed.agents ?? DEFAULT_CONFIG.agents,
      keywords: parsed.keywords ?? DEFAULT_CONFIG.keywords,
      token_bonus: parsed.token_bonus ?? DEFAULT_CONFIG.token_bonus,
      tiers: parsed.tiers ?? DEFAULT_CONFIG.tiers,
      escalation: parsed.escalation ?? DEFAULT_CONFIG.escalation,
      simplification: parsed.simplification ?? DEFAULT_CONFIG.simplification,
      forceInherit: parsed.forceInherit ?? DEFAULT_CONFIG.forceInherit,
      debug: parsed.debug ?? DEFAULT_CONFIG.debug,
    }
  } catch {
    cfg = { ...DEFAULT_CONFIG }
  }

  // env var 오버라이드 (최우선)
  if (process.env.ADVISOR_MODE === "advisor" || process.env.ADVISOR_MODE === "routing") {
    cfg.mode = process.env.ADVISOR_MODE
  }
  if (process.env.ADVISOR_AGENT_HIGH) cfg.agents.high = process.env.ADVISOR_AGENT_HIGH
  if (process.env.ADVISOR_AGENT_MEDIUM) cfg.agents.medium = process.env.ADVISOR_AGENT_MEDIUM
  if (process.env.ADVISOR_AGENT_LOW) cfg.agents.low = process.env.ADVISOR_AGENT_LOW
  if (process.env.ADVISOR_FORCE_INHERIT === "true") cfg.forceInherit = true
  if (process.env.ADVISOR_DEBUG === "true") cfg.debug = true

  return cfg
}

// ─── 모듈 3: 에이전트 검증 ───────────────────────────────────────────────────

function validateAgents(dir: string, cfg: AdvisorConfig): boolean {
  const builtins = ["general", "explore", "build", "compaction", "title", "summary"]
  const agents = new Set([cfg.agents.high, cfg.agents.medium, cfg.agents.low])
  if (cfg.mode === "advisor") {
    agents.add(cfg.advisor.defaultExecutor)
    agents.add(cfg.advisor.advisorAgent)
  }
  for (const name of agents) {
    if (builtins.includes(name)) continue
    const agentPath = join(dir, ".opencode", "agents", `${name}.md`)
    if (!existsSync(agentPath)) {
      console.warn(`[opencode-advisor] ⚠ agent "${name}" not found at ${agentPath} — routing disabled`)
      return false
    }
  }
  return true
}

// ─── 모듈 2: 라우팅 엔진 (weighted scoring + escalation/simplification) ─────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

type RouteResult = {
  agent: string
  score: number
  reason: "escalation" | "simplification" | "score" | "advisor-default"
}

function resolveAgent(prompt: string, cfg: AdvisorConfig): RouteResult {
  const lower = prompt.toLowerCase()

  // 1. escalation 키워드 우선 — 하나라도 있으면 즉시 HIGH
  if (cfg.escalation.keywords.some((kw) => lower.includes(kw))) {
    return { agent: cfg.agents[cfg.escalation.forceTier], score: 0, reason: "escalation" }
  }

  // 2. simplification 전용 판정 — 모든 매칭 키워드가 simplification에만 해당하면 LOW
  const matchedKeywords = Object.keys(cfg.keywords).filter((kw) => lower.includes(kw))
  if (
    matchedKeywords.length > 0 &&
    matchedKeywords.every((kw) => cfg.simplification.keywords.includes(kw))
  ) {
    return { agent: cfg.agents[cfg.simplification.forceTier], score: 0, reason: "simplification" }
  }

  // 3. 기존 가중치 스코어링
  const score = Object.entries(cfg.keywords).reduce(
    (acc, [kw, weight]) => (lower.includes(kw) ? acc + weight : acc),
    0,
  ) + (estimateTokens(prompt) > cfg.token_bonus.threshold ? cfg.token_bonus.weight : 0)

  if (score >= cfg.tiers.high) return { agent: cfg.agents.high, score, reason: "score" }
  if (score >= cfg.tiers.medium) return { agent: cfg.agents.medium, score, reason: "score" }
  return { agent: cfg.agents.low, score, reason: "score" }
}

// ─── Advisor 모드: 기본 executor + keyword guardrail ─────────────────────────

function resolveAdvisorMode(prompt: string, cfg: AdvisorConfig): RouteResult {
  const lower = prompt.toLowerCase()

  // 1. escalation guardrail — force to advisor agent
  if (cfg.escalation.keywords.some((kw) => lower.includes(kw))) {
    return { agent: cfg.advisor.advisorAgent, score: 0, reason: "escalation" }
  }

  // 2. simplification guardrail
  const matchedKeywords = Object.keys(cfg.keywords).filter((kw) => lower.includes(kw))
  if (
    matchedKeywords.length > 0 &&
    matchedKeywords.every((kw) => cfg.simplification.keywords.includes(kw))
  ) {
    return { agent: cfg.agents[cfg.simplification.forceTier], score: 0, reason: "simplification" }
  }

  // 3. default to executor
  return { agent: cfg.advisor.defaultExecutor, score: 0, reason: "advisor-default" }
}

// ─── 모듈 5: 시스템 메시지 (라우팅 로그) ─────────────────────────────────────

function logRoute(before: string, route: RouteResult, debug: boolean) {
  if (!debug) return
  if (before === route.agent) return
  const detail = route.reason === "score"
    ? `score: ${route.score}`
    : route.reason
  console.log(`[opencode-advisor] ${before} → ${route.agent} (${detail})`)
}

// ─── 플러그인 엔트리포인트 ────────────────────────────────────────────────────

export const AdvisorPlugin: Plugin = async (ctx) => {
  const cfg = loadConfig(ctx.directory)
  const enabled = validateAgents(ctx.directory, cfg)

  if (cfg.debug) {
    console.log("[opencode-advisor] 초기화 완료")
    console.log(`[opencode-advisor] mode: ${cfg.mode}`)
    if (cfg.mode === "advisor") {
      console.log(`[opencode-advisor] executor: ${cfg.advisor.defaultExecutor}, advisor: ${cfg.advisor.advisorAgent}`)
    }
    console.log(`[opencode-advisor] agents: high=${cfg.agents.high} medium=${cfg.agents.medium} low=${cfg.agents.low}`)
    console.log(`[opencode-advisor] tiers: high>=${cfg.tiers.high} medium>=${cfg.tiers.medium}`)
    console.log(`[opencode-advisor] keywords: ${Object.keys(cfg.keywords).length}개`)
    console.log(`[opencode-advisor] escalation: [${cfg.escalation.keywords.join(", ")}] → ${cfg.escalation.forceTier}`)
    console.log(`[opencode-advisor] simplification: [${cfg.simplification.keywords.join(", ")}] → ${cfg.simplification.forceTier}`)
    console.log(`[opencode-advisor] forceInherit: ${cfg.forceInherit}`)
  }

  if (!enabled) {
    if (cfg.debug) console.log("[opencode-advisor] routing disabled due to missing agents")
    return {}
  }

  return {
    // ─── 모듈 4: 훅 연결 ─────────────────────────────────────────────
    //
    // 시나리오 B 핵심 (검증된 경로):
    //   1. prompt.ts:567-571: plugin.trigger("tool.execute.before", ..., { args: taskArgs })
    //      → taskArgs 참조를 output으로 전달
    //   2. hook에서 output.args.subagent_type = target (mutation)
    //      → 동일 taskArgs 객체의 속성이 변경됨
    //   3. prompt.ts:584: taskTool.execute(taskArgs, ...) 호출
    //      → 변경된 taskArgs.subagent_type 사용
    //   4. task.ts:56: agent.get(params.subagent_type)
    //      → 변경된 에이전트로 서브에이전트 생성 ✅
    //
    "tool.execute.before": async (input, output) => {
      // task tool만 처리 (TaskTool.id = "task")
      if (input.tool !== "task") return

      // forceInherit: 라우팅 비활성화 — 부모 모델을 그대로 상속
      if (cfg.forceInherit) return

      const args = output.args as {
        prompt?: string
        subagent_type?: string
        description?: string
      }

      const current = args.subagent_type ?? "general"

      // general-only guard: 전문 에이전트(explore, build 등)는 패스스루
      if (current !== "general") return

      const prompt = args.prompt ?? ""
      const route = cfg.mode === "advisor"
        ? resolveAdvisorMode(prompt, cfg)
        : resolveAgent(prompt, cfg)

      // ✅ mutation — 반영됨 (참조 교체가 아닌 속성 변경)
      output.args.subagent_type = route.agent

      logRoute(current, route, cfg.debug)
    },

    // ─── 모듈 5: 시스템 메시지 주입 ─────────────────────────────────
    //
    // 현재 라우팅 설정을 시스템 프롬프트에 부가 컨텍스트로 추가
    //
    "experimental.chat.system.transform": async (_input, output) => {
      // advisor 프로토콜 주입 (advisor 모드, forceInherit 아닐 때)
      if (cfg.mode === "advisor" && !cfg.forceInherit) {
        output.system.push(
          `You can delegate tasks to sub-agents using the Task tool. ` +
            `For most tasks, use subagent_type "general" — the system routes to an efficient executor. ` +
            `When you need strategic guidance from a stronger model, use subagent_type "${cfg.advisor.advisorAgent}":\n` +
            `- BEFORE substantive work: after reading files, before committing to an approach\n` +
            `- When STUCK: errors recurring, approach not converging\n` +
            `- When considering a CHANGE of approach\n` +
            `- Before declaring DONE on complex tasks\n` +
            `When consulting ${cfg.advisor.advisorAgent}, include all relevant context in your prompt. ` +
            `Request a concise plan (under 500 tokens), not execution.`,
        )
      }
      if (!cfg.debug) return
      const mode = cfg.forceInherit ? "inherit" : cfg.mode
      output.system.push(
        `[opencode-advisor] mode=${mode} | ` +
          (cfg.mode === "advisor"
            ? `executor: ${cfg.advisor.defaultExecutor} | advisor: ${cfg.advisor.advisorAgent}`
            : `high(>=${cfg.tiers.high}): ${cfg.agents.high} | ` +
              `medium(>=${cfg.tiers.medium}): ${cfg.agents.medium} | ` +
              `low: ${cfg.agents.low}`),
      )
    },
  }
}

// opencode 플러그인 로더가 server 필드로 로드함
export default {
  server: AdvisorPlugin,
}
