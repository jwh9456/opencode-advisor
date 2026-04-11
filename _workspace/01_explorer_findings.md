# Explorer Findings

> 분석 날짜: 2026-04-11  
> 분석 대상: `/Users/jwh9456/Desktop/workspace/opencode-advisor/_workspace/opencode-src`

---

## 0. 프로젝트 구조

- **언어**: TypeScript (Go가 아님)
- **런타임/빌드**: Bun
- **패키지 매니저**: Bun (bun.lock 존재)
- **모노레포**: Turborepo (`turbo.json`)
- **핵심 패키지**:
  - `packages/opencode/` — 핵심 런타임 (CLI, 에이전트, 도구, 플러그인 내부 구현)
  - `packages/plugin/` — 플러그인 SDK (5개 파일: index.ts, tool.ts, tui.ts, shell.ts, example.ts)
  - `packages/sdk/` — HTTP 클라이언트 SDK
- **핵심 소스 디렉토리**: `packages/opencode/src/`
  - `tool/` — 도구 정의 (task.ts 포함)
  - `plugin/` — 플러그인 로딩 및 훅 디스패치
  - `agent/` — 에이전트 시스템
  - `provider/` — LLM provider
  - `config/` — 설정 구조
  - `session/` — 세션 관리 및 프롬프트 루프

---

## 1. Hook 시스템

### 1.1 Plugin SDK의 hook API

- **파일**: `packages/plugin/src/index.ts` : 189–282
- **API 타입 정의**:

```typescript
export interface Hooks {
  event?: (input: { event: Event }) => Promise<void>
  config?: (input: Config) => Promise<void>
  tool?: { [key: string]: ToolDefinition }
  auth?: AuthHook
  provider?: ProviderHook
  "chat.message"?: (input: { sessionID; agent?; model?; ... }, output: { message; parts }) => Promise<void>
  "chat.params"?: (input: { sessionID; agent; model; provider; message }, output: { temperature; topP; ... }) => Promise<void>
  "chat.headers"?: (input: ..., output: { headers }) => Promise<void>
  "permission.ask"?: (input: Permission, output: { status }) => Promise<void>
  "command.execute.before"?: (input: { command; sessionID; arguments }, output: { parts }) => Promise<void>
  "tool.execute.before"?: (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: any },
  ) => Promise<void>
  "shell.env"?: (input: ..., output: { env }) => Promise<void>
  "tool.execute.after"?: (input: { tool; sessionID; callID; args }, output: { title; output; metadata }) => Promise<void>
  "experimental.chat.messages.transform"?: (input: {}, output: { messages }) => Promise<void>
  "experimental.chat.system.transform"?: (input: { sessionID?; model }, output: { system: string[] }) => Promise<void>
  "experimental.session.compacting"?: (input: { sessionID }, output: { context; prompt? }) => Promise<void>
  "experimental.text.complete"?: (input: { sessionID; messageID; partID }, output: { text }) => Promise<void>
  "tool.definition"?: (input: { toolID }, output: { description; parameters }) => Promise<void>
}
```

### 1.2 trigger 함수 내부 구현

- **파일**: `packages/opencode/src/plugin/index.ts` : 249–262
- **구현 코드**:

```typescript
const trigger = Effect.fn("Plugin.trigger")(function* (name, input, output) {
  if (!name) return output
  const s = yield* InstanceState.get(state)
  for (const hook of s.hooks) {
    const fn = hook[name] as any
    if (!fn) continue
    yield* Effect.promise(async () => fn(input, output))
  }
  return output
})
```

**핵심**: `output` 객체는 참조(reference)로 전달됨. 훅 핸들러가 `output.args.xxx = newValue`처럼 **속성을 변경(mutation)**하면 반영됨. 단, `output.args = newObject`처럼 **참조를 교체**하면 반영 안 됨.

### 1.3 tool.execute.before 실제 호출 지점 (일반 tool)

- **파일**: `packages/opencode/src/session/prompt.ts` : 401–410
- **코드**:

```typescript
execute(args, options) {
  return run.promise(
    Effect.gen(function* () {
      const ctx = context(args, options)
      yield* plugin.trigger(
        "tool.execute.before",
        { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID },
        { args },                  // ← args 참조를 포함한 객체 전달
      )
      const result = yield* item.execute(args, ctx)  // ← 원본 args 사용
```

**args 수정 반영 여부**: **조건부 Yes**
- `output.args.subagent_type = "new"` → **반영됨** (같은 객체를 가리키므로)
- `output.args = { subagent_type: "new" }` → **반영 안 됨** (output의 args 프로퍼티만 교체됨)

**단, 반영되지 않는 이유 분석**: trigger는 `{ args }` 래퍼 객체를 반환하지만, 실행 코드는 원본 `args` 변수를 계속 사용함. output.args를 교체해도 item.execute에는 원본 `args`가 들어감.

### 1.4 task tool의 tool.execute.before 호출 지점 (handleSubtask)

- **파일**: `packages/opencode/src/session/prompt.ts` : 561–585
- **코드**:

```typescript
const taskArgs = {
  prompt: task.prompt,
  description: task.description,
  subagent_type: task.agent,
  command: task.command,
}
yield* plugin.trigger(
  "tool.execute.before",
  { tool: TaskTool.id, sessionID, callID: part.id },
  { args: taskArgs },              // ← taskArgs 참조를 포함한 객체 전달
)

// ...
const result = yield* taskTool.execute(taskArgs, { ... })  // ← 같은 taskArgs 사용!
```

**args 수정 반영 여부**: **조건부 Yes**
- `taskArgs.subagent_type`을 hook 안에서 `output.args.subagent_type = "new"`로 변경하면 **반영됨**
- `output.args = newObject`로 교체하면 **반영 안 됨**

---

## 2. Task/Agent Tool Args

- **정의 파일**: `packages/opencode/src/tool/task.ts` : 21–32
- **TypeScript 코드**:

```typescript
const parameters = z.object({
  description: z.string().describe("A short (3-5 words) description of the task"),
  prompt: z.string().describe("The task for the agent to perform"),
  subagent_type: z.string().describe("The type of specialized agent to use for this task"),
  task_id: z.string()
    .describe("Resume a previous task by passing its task_id")
    .optional(),
  command: z.string().describe("The command that triggered this task").optional(),
})
```

- **model 필드**: **No** — task tool args에는 `model` 파라미터가 없음
- **전체 필드 목록**:
  - `description` (string, required) — 3~5 단어 요약
  - `prompt` (string, required) — 에이전트에게 전달할 태스크 내용
  - `subagent_type` (string, required) — 사용할 에이전트 유형 (예: "general", "explore")
  - `task_id` (string, optional) — 이전 태스크 재개용
  - `command` (string, optional) — 트리거된 명령어

### 2.1 args가 에이전트 생성에 사용되는 흐름

```
TaskTool.execute(params, ctx)
  └── agent.get(params.subagent_type)           → 에이전트 정보 조회
  └── next.model ?? msg.info.{modelID,providerID}  → 모델 결정 (args에서 오지 않음!)
  └── sessions.create(...)                       → 서브세션 생성
  └── ops.prompt({ model: { modelID, providerID }, ... })  → 실제 프롬프트 실행
```

파일: `packages/opencode/src/tool/task.ts` : 56, 103–106

```typescript
// 모델 결정 로직 (task.ts:103-106)
const model = next.model ?? {
  modelID: msg.info.modelID,     // ← 부모 메시지의 모델
  providerID: msg.info.providerID,
}
```

**결론**: 모델은 에이전트 config(`next.model`)나 부모 메시지에서 결정됨. args의 `subagent_type`이 에이전트를 결정하고, 그 에이전트의 config에서 모델이 나옴.

---

## 3. 모델 선택 경로

```
사용자 입력 (PromptInput.model?)
    ↓
createUserMessage() [prompt.ts:910-942]
    ↓ input.model ?? ag.model ?? lastModel(sessionID)
    ↓ ag = agents.get(agentName)  [agent.ts에서 config 읽음]
    ↓ ag.model = config.agent.<name>.model 에서 설정 가능
    ↓
user 메시지 저장 (model.providerID, model.modelID 저장)
    ↓
runLoop() [prompt.ts:1297]
    ↓ lastUser.model.{providerID, modelID}
    ↓ getModel(providerID, modelID, sessionID)
    ↓ provider.getModel() [provider.ts]
    ↓
LLM.stream() [session/llm.ts] → 실제 LLM 호출
```

### 3.1 진입점 → 최종 결정 지점

| 단계 | 파일:라인 | 설명 |
|------|-----------|------|
| 진입점 | `prompt.ts:921` | `input.model ?? ag.model ?? lastModel()` |
| 에이전트 모델 설정 | `agent.ts:250` | `item.model = Provider.parseModel(value.model)` |
| 루프 모델 결정 | `prompt.ts:1356` | `getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID)` |
| Task 서브에이전트 | `task.ts:103-106` | `next.model ?? { modelID: msg.info.modelID, providerID: msg.info.providerID }` |
| Provider lookup | `provider.ts:1629` | `defaultModel()` — config.model → recent → first available |

### 3.2 플러그인이 개입할 수 있는 시점

**런타임 개입 가능 (기존 API)**:
- `"chat.params"` hook: LLM 호출 직전 temperature, topP 등 파라미터 수정 가능
- `"tool.execute.before"` hook: task tool 실행 전 `subagent_type` 속성 변경 가능 (조건부)
- `config` hook: 초기화 시 config 수정 가능 (모델 변경 포함)

**런타임 모델 변경 불가 (현재 API)**:
- `tool.execute.before`에서 `output.args.model`을 설정해도 task.ts에는 해당 필드가 없어 무시됨
- 실제 model은 에이전트 config → 부모 메시지 순으로 결정되며 훅이 직접 개입할 수 없음

---

## 4. Provider 접근

### 4.1 Plugin SDK API (`packages/plugin/src/index.ts`)

```typescript
export type PluginInput = {
  client: ReturnType<typeof createOpencodeClient>  // HTTP API 클라이언트
  project: Project
  directory: string
  worktree: string
  serverUrl: URL
  $: BunShell
}
```

플러그인은 `client` (opencode HTTP API 클라이언트)를 통해 provider/model 목록에 접근 가능.

### 4.2 TUI 플러그인에서 Provider 접근

- **파일**: `packages/plugin/src/tui.ts` : 264–287
- **API**:

```typescript
export type TuiState = {
  readonly provider: ReadonlyArray<Provider>  // ← 현재 로드된 provider 목록
  // ...
}

// TuiPluginApi에서:
state: TuiState  // api.state.provider 로 접근 가능
```

### 4.3 Provider Hook (모델 목록 커스터마이즈)

- **파일**: `packages/plugin/src/index.ts` : 181–184

```typescript
export type ProviderHook = {
  id: string
  models?: (provider: ProviderV2, ctx: ProviderHookContext) => Promise<Record<string, ModelV2>>
}
```

플러그인이 특정 provider의 모델 목록을 완전히 교체할 수 있음.

### 4.4 Config 구조 (model 관련)

- **파일**: `packages/opencode/src/config/config.ts` : 954–963

```typescript
export const Info = z.object({
  model: ModelId.describe("Model to use in the format of provider/model, eg anthropic/claude-2").optional(),
  small_model: ModelId.describe("Small model for title generation").optional(),
  default_agent: z.string().optional(),
  agent: z.object({
    build: Agent.optional(),
    plan: Agent.optional(),
    general: Agent.optional(),
    explore: Agent.optional(),
    // ...
  }).catchall(Agent).optional(),
  // ...
})
```

에이전트별 모델 설정: `config.agent.<name>.model = "provider/model"`

---

## 5. TUI 커스텀 명령어

- **파일**: `packages/plugin/src/tui.ts` : 46–60, 450–460
- **등록 API**:

```typescript
export type TuiCommand = {
  title: string
  value: string
  description?: string
  category?: string
  keybind?: string
  suggested?: boolean
  hidden?: boolean
  enabled?: boolean
  slash?: {
    name: string      // ← /model-route 같은 슬래시 커맨드 등록 가능!
    aliases?: string[]
  }
  onSelect?: () => void
}

// TuiPluginApi.command:
command: {
  register: (cb: () => TuiCommand[]) => () => void  // ← 커맨드 등록
  trigger: (value: string) => void
  show: () => void
}
```

- **가능 여부**: **Yes** — `api.command.register()` 로 `/model-route` 슬래시 커맨드 등록 가능

---

## 6. 시나리오 판정

### 시나리오 A: task tool args에 model 필드가 있고, tool.execute.before hook에서 수정 가능

**판정: 불가능**

**근거**:
1. task tool의 `parameters` 타입에 `model` 필드가 없음 (`packages/opencode/src/tool/task.ts:21-32`)
2. `tool.execute.before` hook에서 `output.args.model = "..."` 설정해도 task.ts에서는 그 값을 읽지 않음
3. task.ts:103에서 모델은 `next.model`(에이전트 config) 또는 부모 메시지에서 결정됨

### 시나리오 B: model 필드는 없지만 다른 우회 경로 존재

**판정: 조건부 가능 (제한적)**

**경로 설명**:

#### B-1: `subagent_type` 수정으로 다른 에이전트(=다른 모델) 사용

- `tool.execute.before` hook에서 `output.args.subagent_type = "my-custom-agent"`로 변경하면 **반영됨**
- `packages/opencode/src/session/prompt.ts:584` — `taskTool.execute(taskArgs, ...)` 시 변경된 `taskArgs.subagent_type` 사용
- config에 `my-custom-agent` 에이전트를 `model: "provider/model"` 포함해서 등록하면 **사실상 모델 라우팅 가능**
- **제약**: `output.args.subagent_type = "new"` 형태(mutation)만 동작, `output.args = newObj` 형태는 동작 안 함

#### B-2: `config` hook으로 에이전트 설정 주입

- 플러그인 `config` hook에서 에이전트 설정을 추가 가능 (`packages/opencode/src/plugin/index.ts:224-231`)
- 조건에 따라 특정 에이전트에 특정 모델을 매핑하는 config 수정 가능
- **제약**: 런타임 중간 변경이 어려움 (초기화 시 1회)

#### B-3: `"experimental.chat.system.transform"` + 커스텀 로직

- system prompt에 모델 선택 힌트를 추가할 수 있으나, 실제 모델 변경은 불가능

#### B-4: TUI에서 커스텀 명령어로 model 변경 안내

- `/model-route` 슬래시 커맨드 등록 후, 사용자가 직접 `@agent-name` 처럼 에이전트를 지정하도록 유도 가능

### 시나리오 C: 기존 Plugin API로 불가능, 코어 수정 필요

**판정: 부분 해당**

**완전한 자동 모델 라우팅 (플러그인만으로 투명하게)을 위해 코어 수정 필요한 부분**:

1. **task tool args에 model 필드 추가** (`packages/opencode/src/tool/task.ts`)
   - `parameters`에 `model: z.string().optional()` 추가
   - task.ts:103의 모델 결정 로직에서 `params.model`도 고려하도록 수정

2. **tool.execute.before trigger의 반환값 활용** (`packages/opencode/src/session/prompt.ts`)
   - 현재 `trigger`의 반환값 (`output`)을 실행 코드에서 사용하지 않음
   - `const { args: resolvedArgs } = yield* plugin.trigger(...)` 후 `item.execute(resolvedArgs, ctx)` 로 변경하면 args 교체가 완전히 동작

3. **모델 선택에 plugin hook 개입 지점 추가**
   - `createUserMessage()` 내 모델 결정 직전 hook을 통해 모델 오버라이드 가능하도록 API 확장

---

## 7. 추가 참고 정보

### trigger 함수의 output 변경 패턴 (올바른 사용법)

```typescript
// 훅 핸들러에서 올바른 수정 방법 (mutation):
"tool.execute.before": async (input, output) => {
  if (input.tool === "task") {
    output.args.subagent_type = "my-model-specific-agent"  // ✅ 반영됨
    // output.args = { subagent_type: "new" }              // ❌ 반영 안 됨
  }
}
```

### 에이전트별 모델 설정 예시 (config 방식)

```jsonc
// opencode.jsonc
{
  "agent": {
    "fast-agent": {
      "model": "anthropic/claude-haiku-4",
      "mode": "subagent",
      "description": "Fast agent for simple tasks"
    },
    "powerful-agent": {
      "model": "anthropic/claude-sonnet-4-5",
      "mode": "subagent"
    }
  }
}
```

이 설정 후 hook에서 `output.args.subagent_type`을 조건에 따라 변경하면 사실상 모델 라우팅이 됨.

### SDK 타입 접근 경로

- `packages/plugin/src/index.ts` import: `from "@opencode-ai/sdk"` — `Model`, `Provider`, `Event` 타입
- `packages/plugin/src/index.ts` import: `from "@opencode-ai/sdk/v2"` — `Provider as ProviderV2`, `Model as ModelV2`
- TUI에서: `api.state.provider` — `ReadonlyArray<Provider>` (tui.ts:267)
- Server plugin에서: `input.client` — HTTP API 클라이언트로 `/provider`, `/model` 엔드포인트 호출 가능
