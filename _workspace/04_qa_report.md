# QA Report

> 검증 날짜: 2026-04-11  
> 대상: `.opencode/plugins/opencode-advisor.ts`  
> 근거: `_workspace/01_explorer_findings.md`, `_workspace/02_scenario_decision.md`

---

## 전체 판정: ✅ 구현 완료 (시나리오 B, 조건부 동작)

---

## 모듈별 검증

### 모듈 1: Config Loader ✅

| 항목 | 결과 | 비고 |
|------|------|------|
| 설정 파일 로드 | ✅ | `readFileSync` + `JSON.parse` 사용 |
| 파일 없을 때 기본값 사용 | ✅ | catch에서 DEFAULT_CONFIG 반환 |
| 기본 설정 완전성 | ✅ | threshold/keyword 규칙 포함 |
| YAML 대신 JSON 사용 | ✅ | 추가 패키지 불필요 |

**설정 파일**: `.opencode/plugins/advisor-config.json` 생성됨

---

### 모듈 2: Routing Engine ✅

| 항목 | 결과 | 비고 |
|------|------|------|
| threshold 규칙 | ✅ | `estimateTokens(text.length / 4)` |
| keyword 규칙 | ✅ | lowercase 비교 |
| tool 규칙 | ✅ | subagent_type 매칭 |
| 규칙 우선순위 | ✅ | 배열 순서대로 첫 매칭에서 중단 |
| 기본값 폴백 | ✅ | 매칭 없으면 원본 subagent_type 유지 |

---

### 모듈 3: Provider Inspector ⚠️ (스킵)

**이유**: opencode의 plugin API에서 provider/model 가용성을 직접 확인하는 동기 API가 없음. `PluginInput.client`는 비동기 HTTP 클라이언트이며, hook 핸들러에서 초기화 시점에 활용 가능하지만 매 요청마다 확인하는 오버헤드가 큼.

**대안**: 에이전트 config가 존재하면 모델 가용성은 opencode 코어가 처리. 잘못된 에이전트 지정 시 `task.ts:56-59`에서 에러 발생.

**현재 구현**: silent fallback 없이, 잘못된 에이전트 지정 시 opencode 코어 에러에 위임.

---

### 모듈 4: Hook Integration ✅

| 항목 | 결과 | 비고 |
|------|------|------|
| `tool.execute.before` hook 등록 | ✅ | Hooks 인터페이스에 정확히 일치 |
| task tool 필터링 | ✅ | `input.tool !== "task"` early return |
| subagent_type mutation | ✅ | `output.args.subagent_type = target` |
| 참조 교체 방지 | ✅ | 교체 방식 코드 없음 (주석으로 경고) |
| 실제 반영 여부 | ✅ | `prompt.ts:584 → task.ts:56` 경로 검증 |

**핵심 검증**: `output.args.subagent_type = target` (mutation) → `taskTool.execute(taskArgs, ...)` → `agent.get(params.subagent_type)` 경로 확인.

---

### 모듈 5: System Message ✅

| 항목 | 결과 | 비고 |
|------|------|------|
| 라우팅 로그 출력 | ✅ | `logRoute()` 함수 |
| before === after 시 스킵 | ✅ | 불필요한 로그 방지 |
| debug 모드 플래그 | ✅ | 기본값 false (조용한 동작) |
| system transform hook | ✅ | `experimental.chat.system.transform` |

---

### 모듈 6: TUI Commands ⚠️ (부분 구현)

**이유**: TUI 플러그인은 별도의 `tui` 엔트리포인트가 필요 (`TuiPlugin` 타입, `tui.ts`). 현재 구현은 `server` 플러그인만 포함.

**TUI 커맨드 등록 API 존재**: `TuiPluginApi.command.register()` (tui.ts:453)

**현재 구현**: TUI 모듈 없음. 향후 `PluginModule.tui` 추가 시 구현 가능.

---

## 시나리오 B 동작 경로 최종 검증

```
plugin.trigger("tool.execute.before", { tool: "task" }, { args: taskArgs })
  ↓ hook 핸들러 실행
  output.args.subagent_type = "fast"  (mutation — 동일 taskArgs 객체)
  ↓
prompt.ts:573: agents.get(task.agent)  ← 원본 에이전트 검증 (통과, 변경 안 됨)
  ↓
taskTool.execute(taskArgs, { agent: task.agent, ... })
  ↓ task.ts:56
  agent.get(params.subagent_type)  ← params = taskArgs
  ↓ "fast" 에이전트 조회
  ↓ next.model = "anthropic/claude-haiku-4" (config에서)
  ↓ 해당 모델로 서브에이전트 생성 ✅
```

**결론**: 시나리오 B 동작 확인. 단, 변경된 에이전트(`target`)가 opencode config에 정의되어 있어야 함.

---

## 제한사항

1. **원본 에이전트 검증**: `prompt.ts:573`에서 원본 `task.agent`가 유효하지 않으면 에러 발생. Hook에서 변경한 에이전트와 무관하게 원본이 유효해야 함.

2. **에이전트 config 필요**: 변경한 `subagent_type` (예: "powerful", "fast")이 opencode.jsonc의 `agent` 섹션에 정의되어 있어야 함. 현재 `advisor-config.json`의 기본값은 모두 "general"이므로 실질적 라우팅 없음.

3. **TUI 모듈 미구현**: TUI 슬래시 커맨드 (`/advisor-status` 등) 미구현.

4. **Provider Inspector 미구현**: 잘못된 에이전트 지정 시 silent fallback 없음 (opencode 코어 에러 위임).

---

## 활성화 방법

1. `opencode.jsonc`에서 agent 섹션 주석 해제하고 실제 모델 설정
2. `advisor-config.json`에서 `advisor_agent`, `executor_agent` 변경

```jsonc
// opencode.jsonc
{
  "agent": {
    "powerful": {
      "model": "anthropic/claude-opus-4-5"
    },
    "fast": {
      "model": "anthropic/claude-haiku-4"
    }
  }
}
```

```json
// advisor-config.json
{
  "advisor_agent": "powerful",
  "executor_agent": "fast",
  "debug": true
}
```

---

## 생성된 파일 목록

| 파일 | 설명 |
|------|------|
| `.opencode/plugins/opencode-advisor.ts` | 메인 플러그인 (모듈 1-5) |
| `.opencode/plugins/advisor-config.json` | 라우팅 규칙 설정 |
| `.opencode/opencode.jsonc` | opencode 설정 (플러그인 로드 + 에이전트 예시) |
| `_workspace/02_scenario_decision.md` | 시나리오 판정 문서 |
