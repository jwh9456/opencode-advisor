import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

import {
  buildAdvisorPrompt,
  createAdvisorTool,
  extractText,
  loadConfig,
  parseModel,
  resetAdvisorCounter,
} from "./index"

describe("opencode-advisor helpers", () => {
  beforeEach(() => {
    resetAdvisorCounter()
    delete process.env.ADVISOR_MODEL
    delete process.env.ADVISOR_SYSTEM
    delete process.env.ADVISOR_DEBUG
    delete process.env.ADVISOR_MAX_CALLS
  })

  afterEach(() => {
    resetAdvisorCounter()
    delete process.env.ADVISOR_MODEL
    delete process.env.ADVISOR_SYSTEM
    delete process.env.ADVISOR_DEBUG
    delete process.env.ADVISOR_MAX_CALLS
  })

  test("buildAdvisorPrompt includes blocker details and context", () => {
    const prompt = buildAdvisorPrompt({
      question: "How should I refactor this?",
      blocker: "I cannot break a circular dependency without moving ownership.",
      attempted: "I tried extracting interfaces and splitting helpers, but the repository still imports parser code.",
      context: "Current module has circular dependencies.",
    })

    expect(prompt).toContain("Question:")
    expect(prompt).toContain("How should I refactor this?")
    expect(prompt).toContain("Blocker:")
    expect(prompt).toContain("What I already tried:")
    expect(prompt).toContain("Context:")
    expect(prompt).toContain("circular dependencies")
  })

  test("extractText concatenates only text parts", () => {
    const result = extractText([
      { type: "text", text: "step 1" },
      { type: "reasoning" } as never,
      { type: "text", text: "step 2" },
    ])

    expect(result).toBe("step 1\n\nstep 2")
  })

  test("parseModel parses provider/model strings", () => {
    expect(parseModel("anthropic/claude-opus-4-5")).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-4-5",
    })
    expect(parseModel("invalid")).toBeUndefined()
    expect(parseModel(null)).toBeUndefined()
  })

  test("loadConfig uses defaults and env overrides", () => {
    const dir = mkdtempSync(join(tmpdir(), "advisor-config-"))
    const home = mkdtempSync(join(tmpdir(), "advisor-home-"))
    mkdirSync(join(dir, ".opencode", "plugins"), { recursive: true })
    writeFileSync(
      join(dir, ".opencode", "plugins", "advisor-config.json"),
      JSON.stringify({ advisorModel: "openai/gpt-4.1", debug: false }),
      "utf-8",
    )

    process.env.ADVISOR_MODEL = "anthropic/claude-opus-4-5"
    process.env.ADVISOR_DEBUG = "true"
    process.env.ADVISOR_MAX_CALLS = "3"

    const cfg = loadConfig(dir, home)

    expect(cfg.advisorModel).toBe("anthropic/claude-opus-4-5")
    expect(cfg.debug).toBe(true)
    expect(cfg.maxAdvisorCalls).toBe(3)

    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  test("loadConfig ignores malformed field types", () => {
    const dir = mkdtempSync(join(tmpdir(), "advisor-config-invalid-"))
    const home = mkdtempSync(join(tmpdir(), "advisor-home-invalid-"))
    mkdirSync(join(dir, ".opencode", "plugins"), { recursive: true })
    writeFileSync(
      join(dir, ".opencode", "plugins", "advisor-config.json"),
      JSON.stringify({ advisorModel: 123, advisorSystem: 456, maxAdvisorCalls: -1, debug: "yes" }),
      "utf-8",
    )

    const cfg = loadConfig(dir, home)

    expect(cfg.advisorModel).toBeNull()
    expect(cfg.advisorSystem).toBeNull()
    expect(cfg.maxAdvisorCalls).toBe(1)
    expect(cfg.debug).toBe(false)

    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  test("loadConfig uses global config when local file is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "advisor-config-local-missing-"))
    const home = mkdtempSync(join(tmpdir(), "advisor-home-global-only-"))
    mkdirSync(join(home, ".config", "opencode", "plugins"), { recursive: true })
    writeFileSync(
      join(home, ".config", "opencode", "plugins", "advisor-config.json"),
      JSON.stringify({ advisorModel: "openai/o3", advisorSystem: "global system", maxAdvisorCalls: 2, debug: true }),
      "utf-8",
    )

    const cfg = loadConfig(dir, home)

    expect(cfg.advisorModel).toBe("openai/o3")
    expect(cfg.advisorSystem).toBe("global system")
    expect(cfg.maxAdvisorCalls).toBe(2)
    expect(cfg.debug).toBe(true)

    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })

  test("loadConfig lets local config override global config", () => {
    const dir = mkdtempSync(join(tmpdir(), "advisor-config-local-override-"))
    const home = mkdtempSync(join(tmpdir(), "advisor-home-local-override-"))
    mkdirSync(join(home, ".config", "opencode", "plugins"), { recursive: true })
    mkdirSync(join(dir, ".opencode", "plugins"), { recursive: true })
    writeFileSync(
      join(home, ".config", "opencode", "plugins", "advisor-config.json"),
      JSON.stringify({ advisorModel: "openai/o3", advisorSystem: "global system", maxAdvisorCalls: 2, debug: false }),
      "utf-8",
    )
    writeFileSync(
      join(dir, ".opencode", "plugins", "advisor-config.json"),
      JSON.stringify({ advisorModel: null, maxAdvisorCalls: 4, debug: true }),
      "utf-8",
    )

    const cfg = loadConfig(dir, home)

    expect(cfg.advisorModel).toBeNull()
    expect(cfg.advisorSystem).toBe("global system")
    expect(cfg.maxAdvisorCalls).toBe(4)
    expect(cfg.debug).toBe(true)

    rmSync(dir, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  })
})

describe("advisor tool", () => {
  beforeEach(() => {
    resetAdvisorCounter()
  })

  afterEach(() => {
    resetAdvisorCounter()
  })

  test("returns advisor text on successful fork and prompt", async () => {
    const deleted: string[] = []
    const pluginCtx = {
      client: {
        session: {
          fork: async () => ({ data: { id: "child-1" }, error: undefined }),
          prompt: async () => ({
            data: {
              info: { id: "msg-1" },
              parts: [{ type: "text", text: "1. Start with a narrow interface." }],
            },
            error: undefined,
          }),
          delete: async ({ path }: { path: { id: string } }) => {
            deleted.push(path.id)
            return { data: true, error: undefined }
          },
        },
      },
    } as never

    const advisor = createAdvisorTool(
      pluginCtx,
      {
        advisorModel: "anthropic/claude-opus-4-5",
        advisorSystem: null,
        maxAdvisorCalls: 0,
        debug: false,
      },
      new Set<string>(),
    )

    const result = await advisor.execute(
      {
        question: "How should I split this module?",
        blocker: "Parser and repository still depend on each other.",
        attempted: "I extracted helper functions, but ownership is still unclear.",
      },
      {
        sessionID: "parent-1",
        messageID: "message-1",
        agent: "build",
        directory: "/tmp",
        worktree: "/tmp",
        abort: new AbortController().signal,
        metadata() {},
        ask: async () => {},
      },
    )

    expect(result).toBe("1. Start with a narrow interface.")
    expect(deleted).toEqual(["child-1"])
  })

  test("blocks recursive advisor calls", async () => {
    const advisor = createAdvisorTool(
      {
        client: {
          session: {
            fork: async () => ({ data: { id: "child-1" }, error: undefined }),
            prompt: async () => ({ data: { info: {}, parts: [] }, error: undefined }),
            delete: async () => ({ data: true, error: undefined }),
          },
        },
      } as never,
      {
        advisorModel: null,
        advisorSystem: null,
        maxAdvisorCalls: 0,
        debug: false,
      },
      new Set(["parent-1"]),
    )

    const result = await advisor.execute(
      {
        question: "help",
        blocker: "I am blocked in the child session.",
        attempted: "I already tried to answer directly.",
      },
      {
        sessionID: "parent-1",
        messageID: "message-1",
        agent: "build",
        directory: "/tmp",
        worktree: "/tmp",
        abort: new AbortController().signal,
        metadata() {},
        ask: async () => {},
      },
    )

    expect(result).toContain("recursive advisor call blocked")
  })

  test("enforces maxAdvisorCalls budget", async () => {
    const advisor = createAdvisorTool(
      {
        client: {
          session: {
            fork: async () => ({ data: { id: "child-1" }, error: undefined }),
            prompt: async () => ({ data: { info: {}, parts: [{ type: "text", text: "ok" }] }, error: undefined }),
            delete: async () => ({ data: true, error: undefined }),
          },
        },
      } as never,
      {
        advisorModel: null,
        advisorSystem: null,
        maxAdvisorCalls: 1,
        debug: false,
      },
      new Set<string>(),
    )

    const toolCtx = {
      sessionID: "parent-1",
      messageID: "message-1",
      agent: "build",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata() {},
      ask: async () => {},
    }

    const first = await advisor.execute(
      {
        question: "first",
        blocker: "Unsure which boundary should own validation.",
        attempted: "I tried two decompositions and both keep the cycle.",
      },
      toolCtx,
    )
    const second = await advisor.execute(
      {
        question: "second",
        blocker: "Still blocked on ownership after first attempt.",
        attempted: "I tried applying the first suggestion but hit the same coupling.",
      },
      toolCtx,
    )

    expect(first).toBe("ok")
    expect(second).toContain("budget exhausted")
  })

  test("does not spend budget when session fork fails", async () => {
    const advisor = createAdvisorTool(
      {
        client: {
          session: {
            fork: async () => ({ error: { data: { message: "fork failed" } } }),
            prompt: async () => ({ data: { info: {}, parts: [] }, error: undefined }),
            delete: async () => ({ data: true, error: undefined }),
          },
        },
      } as never,
      {
        advisorModel: null,
        advisorSystem: null,
        maxAdvisorCalls: 1,
        debug: false,
      },
      new Set<string>(),
    )

    const toolCtx = {
      sessionID: "parent-1",
      messageID: "message-1",
      agent: "build",
      directory: "/tmp",
      worktree: "/tmp",
      abort: new AbortController().signal,
      metadata() {},
      ask: async () => {},
    }

    const failed = await advisor.execute(
      {
        question: "first",
        blocker: "I cannot proceed without a decomposition decision.",
        attempted: "I tried extracting interfaces first.",
      },
      toolCtx,
    )
    const retried = await advisor.execute(
      {
        question: "second",
        blocker: "The same blocker remains because the fork failed.",
        attempted: "I retried with a narrower split.",
      },
      toolCtx,
    )

    expect(failed).toContain("failed to create advisor session")
    expect(retried).toContain("failed to create advisor session")
  })

  test("returns graceful fallback when prompt fails", async () => {
    const advisor = createAdvisorTool(
      {
        client: {
          session: {
            fork: async () => ({ data: { id: "child-1" }, error: undefined }),
            prompt: async () => ({ error: { data: { message: "prompt failed" } } }),
            delete: async () => ({ data: true, error: undefined }),
          },
        },
      } as never,
      {
        advisorModel: null,
        advisorSystem: null,
        maxAdvisorCalls: 0,
        debug: false,
      },
      new Set<string>(),
    )

    const result = await advisor.execute(
      {
        question: "help",
        blocker: "I need a decision on ownership.",
        attempted: "I tried to continue without advisor and got stuck.",
      },
      {
        sessionID: "parent-1",
        messageID: "message-1",
        agent: "build",
        directory: "/tmp",
        worktree: "/tmp",
        abort: new AbortController().signal,
        metadata() {},
        ask: async () => {},
      },
    )

    expect(result).toContain("prompt failed")
  })

  test("skips advisor calls without blocker evidence", async () => {
    const advisor = createAdvisorTool(
      {
        client: {
          session: {
            fork: async () => ({ data: { id: "child-1" }, error: undefined }),
            prompt: async () => ({ data: { info: {}, parts: [{ type: "text", text: "ok" }] }, error: undefined }),
            delete: async () => ({ data: true, error: undefined }),
          },
        },
      } as never,
      {
        advisorModel: null,
        advisorSystem: null,
        maxAdvisorCalls: 1,
        debug: false,
      },
      new Set<string>(),
    )

    const result = await advisor.execute(
      {
        question: "help",
        blocker: "",
        attempted: "",
      },
      {
        sessionID: "parent-1",
        messageID: "message-1",
        agent: "build",
        directory: "/tmp",
        worktree: "/tmp",
        abort: new AbortController().signal,
        metadata() {},
        ask: async () => {},
      },
    )

    expect(result).toContain("advisor skipped")
  })

  test("returns early when request is already aborted", async () => {
    const controller = new AbortController()
    controller.abort()

    const advisor = createAdvisorTool(
      {
        client: {
          session: {
            fork: async () => ({ data: { id: "child-1" }, error: undefined }),
            prompt: async () => ({ data: { info: {}, parts: [{ type: "text", text: "ok" }] }, error: undefined }),
            delete: async () => ({ data: true, error: undefined }),
          },
        },
      } as never,
      {
        advisorModel: null,
        advisorSystem: null,
        maxAdvisorCalls: 0,
        debug: false,
      },
      new Set<string>(),
    )

    const result = await advisor.execute(
      {
        question: "help",
        blocker: "I am blocked before starting another attempt.",
        attempted: "I tried a concrete edit path first.",
      },
      {
        sessionID: "parent-1",
        messageID: "message-1",
        agent: "build",
        directory: "/tmp",
        worktree: "/tmp",
        abort: controller.signal,
        metadata() {},
        ask: async () => {},
      },
    )

    expect(result).toContain("request aborted")
  })

  test("returns graceful fallback when session fork fails", async () => {
    const advisor = createAdvisorTool(
      {
        client: {
          session: {
            fork: async () => ({ error: { data: { message: "fork failed" } } }),
            prompt: async () => ({ data: { info: {}, parts: [] }, error: undefined }),
            delete: async () => ({ data: true, error: undefined }),
          },
        },
      } as never,
      {
        advisorModel: null,
        advisorSystem: null,
        maxAdvisorCalls: 0,
        debug: false,
      },
      new Set<string>(),
    )

    const result = await advisor.execute(
      {
        question: "help",
        blocker: "I still cannot choose a safe split.",
        attempted: "I tried pushing ahead without advisor guidance.",
      },
      {
        sessionID: "parent-1",
        messageID: "message-1",
        agent: "build",
        directory: "/tmp",
        worktree: "/tmp",
        abort: new AbortController().signal,
        metadata() {},
        ask: async () => {},
      },
    )

    expect(result).toContain("failed to create advisor session")
  })
})
