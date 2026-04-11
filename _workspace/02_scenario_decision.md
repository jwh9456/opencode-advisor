# Scenario Decision

> 결정 날짜: 2026-04-11  
> 기반 문서: `_workspace/01_explorer_findings.md`

---

## 판정: **시나리오 B (우회 라우팅)**

### 근거

| 검증 항목 | 결과 | 증거 |
|----------|------|------|
| task tool args에 `model` 필드 존재 여부 | **없음** | `packages/opencode/src/tool/task.ts:21-32` |
| `tool.execute.before` hook에서 args 전체 교체 가능 | **불가** | `prompt.ts:96` — `output.args = newObj` 교체 시 반영 안 됨 |
| `tool.execute.before` hook에서 args 속성 mutation 가능 | **가능** | `prompt.ts:584` — handleSubtask에서 동일 `taskArgs` 객체 재사용 |
| `output.args.subagent_type` 변경 시 다른 에이전트 사용 | **가능** | `task.ts:56` — `agent.get(params.subagent_type)` |
| 에이전트별 모델 설정 | **가능** | `config.ts:954-963` — `agent.<name>.model` |

### 시나리오 A 불가 이유

task tool의 parameters (`task.ts:21-32`)에 `model` 필드가 없으므로, 플러그인에서 `output.args.model`을 설정해도 task.ts에서 해당 값을 읽지 않는다. 따라서 시나리오 A는 **현재 코드베이스에서 불가능**.

### 시나리오 B 구현 원리

```
플러그인 "tool.execute.before" hook
  └── input.tool === "task" 판단
  └── 태스크 prompt/context 분석 → 적합한 에이전트 유형 결정
  └── output.args.subagent_type = "fast-agent" (mutation!)
       ↓
task.ts:56: agent.get("fast-agent")
       ↓
에이전트 config: fast-agent.model = "anthropic/claude-haiku-4"
       ↓
실제로 해당 모델로 서브에이전트 실행
```

**핵심 제약**: `output.args.subagent_type = "value"` (mutation) 방식만 동작. `output.args = { ... }` (교체) 방식은 동작하지 않음.

### 시나리오 C 해당 항목 (코어 수정 필요)

완전히 투명한 자동 모델 라우팅(사용자가 에이전트를 알지 않아도 되는)을 위해서는:
1. `task.ts` parameters에 `model` 필드 추가 (Go PR이 아닌 TypeScript PR)
2. `prompt.ts`의 trigger 반환값 활용 변경

이 부분은 현재 구현에서 **스킵**하고, `subagent_type` 우회 경로로 진행.

---

## 구현 범위

| 모듈 | 구현 여부 | 설명 |
|------|----------|------|
| 모듈 1: Config Loader | ✅ 구현 | `config.yaml` 로드, 에이전트별 모델 매핑 설정 |
| 모듈 2: Routing Engine | ✅ 구현 | 태스크 유형 분석 → 에이전트 선택 로직 |
| 모듈 3: Provider Inspector | ✅ 구현 | 사용 가능한 provider/model 조회 |
| 모듈 4: Hook Integration | ✅ 구현 | `tool.execute.before` + `output.args.subagent_type` mutation |
| 모듈 5: System Message | ✅ 구현 | `experimental.chat.system.transform` hook |
| 모듈 6: TUI Commands | ✅ 구현 | `/advisor-status`, `/advisor-route` 슬래시 커맨드 |

---

## Hook 구현 패턴 (시나리오 B 핵심)

```typescript
// tool.execute.before hook — 올바른 구현 (mutation 방식)
"tool.execute.before": async (input, output) => {
  if (input.tool === "task") {
    const agentType = await routingEngine.decide(output.args.prompt)
    output.args.subagent_type = agentType  // ✅ mutation — 반영됨
    // output.args = { ...output.args, subagent_type: agentType }  // ❌ 교체 — 반영 안 됨
  }
}
```

---

## config.yaml 기본 구조 (에이전트 모델 매핑)

```yaml
routing:
  enabled: true
  rules:
    - match: "simple|quick|fast"
      agent: fast-agent
    - match: "complex|architecture|design"
      agent: powerful-agent
    - default: general

agents:
  fast-agent:
    model: "anthropic/claude-haiku-4"
    description: "빠른 단순 작업용"
  powerful-agent:
    model: "anthropic/claude-opus-4-5"
    description: "복잡한 설계/분석 작업용"
```

---

## 특이사항

1. **일반 tool (task가 아닌)**의 `tool.execute.before`: `prompt.ts:401-410` — 여기서는 `const result = yield* item.execute(args, ctx)` 형태로 원본 `args` 변수를 사용하므로, mutation은 반영되지만 **실질적인 모델 라우팅 효과 없음** (task tool에만 subagent_type 개념 존재)

2. **config hook**: 플러그인 초기화 시 1회 실행되므로, 에이전트-모델 매핑은 startup time에 config에 주입 가능. 런타임 동적 변경은 별도 메커니즘 필요.

3. **handleSubtask 경로**: 실제로 hook이 task를 처리하는 경로는 `prompt.ts:561-585` (handleSubtask)이며, 이 경로에서만 `taskArgs` 객체가 mutation 이후에도 `taskTool.execute(taskArgs, ...)` 에 그대로 전달됨 — 이 경로가 시나리오 B의 핵심.
