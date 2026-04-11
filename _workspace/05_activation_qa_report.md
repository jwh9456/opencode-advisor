# QA Report — Routing Activation + Doc Fixes

> 검증 일시: 2026-04-11  
> 검증 대상: 에이전트 파일 생성, config 업데이트, 플러그인 수정, 문서 수정

---

## 검증 결과 요약

| 섹션 | 통과 | 실패 | 미해결 |
|------|------|------|--------|
| 1. powerful.md | 5/5 | 0 | 0 |
| 2. fast.md | 5/5 | 0 | 0 |
| 3. advisor-config.json | 2/4 | **2** | 0 |
| 4. opencode.jsonc | 2/3 | **1** | 0 |
| 5. opencode-advisor.ts | 5/8 | **3** | 0 |
| 6. 교차 검증 (config ↔ 에이전트) | 2/3 | **1** | 0 |
| 7. Doc fixes (Go→TypeScript) | 3/4 | **1** | 0 |
| 8. E2E 라우팅 흐름 | 5/6 | **1** | 0 |

**전체: 29/38 통과 | 실패 9개**

---

## ✅ 통과 항목

### 1. `.opencode/agents/powerful.md`
- ✅ 파일 존재
- ✅ `name: powerful` (line 2)
- ✅ `model: github-copilot/claude-opus-4.6` (line 3)
- ✅ `mode: subagent` (line 5)
- ✅ `hidden: true` (line 6)
- ✅ 의미 있는 시스템 프롬프트 존재 (line 9: "You are a general-purpose coding assistant optimized for complex tasks...")

### 2. `.opencode/agents/fast.md`
- ✅ 파일 존재
- ✅ `name: fast` (line 2)
- ✅ `model: github-copilot/claude-haiku-4` (line 3)
- ✅ `mode: subagent` (line 5)
- ✅ `hidden: true` (line 6)
- ✅ 의미 있는 시스템 프롬프트 존재 (line 9: "You are a fast, focused coding assistant...")

### 3. `.opencode/plugins/advisor-config.json`
- ✅ Rules 배열 3개 유지 (threshold, keyword-advisor, keyword-executor)
- ✅ Rules 내용 변경 없음 (threshold: 2000, keyword match 목록 보존)
- ❌ `advisor_agent`가 `"powerful"`이어야 하는데 현재 `"general"` (line 2)
- ❌ `executor_agent`가 `"fast"`이어야 하는데 현재 `"general"` (line 3)
- ❌ `debug`가 `true`이어야 하는데 현재 `false` (line 4)

### 4. `.opencode/opencode.jsonc`
- ✅ Plugin 배열에 `".opencode/plugins/opencode-advisor.ts"` 포함 (line 12)
- ❌ 주석 처리된 agent 섹션이 여전히 존재 (lines 25–34) — 스펙은 "완전히 제거"를 요구
  - `// "agent": { ... }` 블록이 lines 24–34에 남아 있음
  - 추가로 lines 15–23에 긴 주석 블록이 있음 (스펙은 "clean, minimal config" 요구)

> **참고**: opencode.jsonc에 agent 섹션 주석이 남아 있는 이유는 `.opencode/agents/powerful.md`와 `.opencode/agents/fast.md` 파일을 통한 새 라우팅 방식으로 전환했기 때문에 opencode.jsonc의 agent 섹션은 불필요. 그러나 스펙의 "No commented-out agent section (was lines 15-34, should be removed)"을 명시적으로 충족하지 못함.

### 5. `.opencode/plugins/opencode-advisor.ts`
- ❌ `existsSync`가 **import되지 않음** — line 15: `import { readFileSync } from "fs"` (existsSync 없음)
- ❌ `validateAgents()` 함수가 **존재하지 않음** — 전체 파일에 validateAgents 함수 없음
- ❌ 따라서 관련 검사 항목들 모두 미충족:
  - ❌ 빌트인 에이전트(`general`, `explore`, `build` 등) 스킵 로직 없음
  - ❌ 검증 실패 시 `{}` 반환 (빈 훅 = pass-through) 로직 없음
  - ❌ 검증 실패 + debug 시 경고 로그 없음
- ✅ 원본 훅 로직 `tool.execute.before` 유지 (lines 136–156)
- ✅ 원본 훅 로직 `experimental.chat.system.transform` 유지 (lines 163–169)
- ✅ `AdvisorConfig` 타입 변경 없음 (lines 27–32)
- ✅ `loadConfig` 함수 변경 없음 (lines 53–66)
- ✅ `resolveAgent` 함수 변경 없음 (lines 74–95)

### 6. 교차 검증: Config ↔ Agent 파일 일치
- ❌ `advisor-config.json`의 `advisor_agent`가 `"general"`이어서 `powerful.md`와 불일치
  - advisor-config.json line 2: `"advisor_agent": "general"`
  - 에이전트 파일: `.opencode/agents/powerful.md` (name: powerful)
  - **결론**: advisor_agent가 `"powerful"`로 업데이트되어야 연결됨
- ❌ `advisor-config.json`의 `executor_agent`가 `"general"`이어서 `fast.md`와 불일치
  - advisor-config.json line 3: `"executor_agent": "general"`
  - 에이전트 파일: `.opencode/agents/fast.md` (name: fast)
  - **결론**: executor_agent가 `"fast"`로 업데이트되어야 연결됨
- ✅ 플러그인 코드가 `output.args.subagent_type = target` mutation 방식 사용 (올바른 반영 경로 확인됨)

> **중요**: agent 파일은 정확히 생성되었으나 advisor-config.json이 아직 업데이트되지 않아 라우팅이 실제로는 작동하지 않음. 현재 상태에서는 모든 작업이 "general" 에이전트로 라우팅됨.

### 7. Doc fixes (Go→TypeScript)

#### `.opencode/agents/opencode-explorer.md`
- ✅ "Go" 참조 없음 — 전체 파일에서 TypeScript/Bun 용어만 사용

#### `.opencode/agents/plugin-dev.md`
- ✅ line 38: "Go PR 필요성 보고" → 검토 결과 현재 내용:
  ```
  리더에게 Go PR 필요성 보고
  ```
  - ❌ **여전히 "Go PR" 표현 존재** (line 38)
  - 기대: "TypeScript 코어 수정 필요성 보고" 또는 유사한 표현

#### `.opencode/agents/plugin-qa.md`
- ❌ **line 19 여전히 "Go 코드" 표현 사용**:
  ```
  2. **explorer 결과 일치성** — Go 코드의 실제 구조와 플러그인 코드가 일치하는지
  ```
  - 기대: "TypeScript 코드의 실제 구조와 플러그인 코드가 일치하는지"

#### `.opencode/skills/opencode-research/SKILL.md`
- ❌ **다수의 Go 참조가 업데이트되지 않음**:
  - line 3 description: `"opencode Go 코드베이스를 체계적으로 탐색하는 가이드. Go 소스에서 hook 시스템..."`
  - line 6: `# OpenCode Go 코드베이스 탐색 가이드`
  - line 8: `opencode의 Go 소스에서...`
  - line 18: `Go 모듈 구조(\`go.mod\`, \`main.go\`)와 주요 패키지(\`internal/\`, \`pkg/\`, \`cmd/\`)를 파악한다.`
  - line 21-24: 경로가 `internal/tool/`, `internal/llm/`, `internal/plugin/`, `internal/config/`로 되어 있음 — 실제 경로는 `packages/opencode/src/tool/`, `packages/opencode/src/plugin/` 등
  - lines 56-58: "Task tool args의 Go struct 전체 정의", "args → agent 생성까지의 코드 흐름"
  - line 93: `handler 시그니처: {Go 코드}`, line 102-104: `struct: {Go 코드}` 등 출력 형식에 Go 코드 참조
  - line 126: `Go 코드의 interface는 구현체를 반드시 찾아 확인하라. interface 정의만으로는 실제 동작을 알 수 없다`

### 8. E2E 라우팅 흐름 추적

**시나리오**: LLM이 `subagent_type: "general"`, prompt: "refactor this module"로 task tool 호출

| 단계 | 코드 위치 | 상태 |
|------|-----------|------|
| 1. LLM이 task tool 호출 (`subagent_type: "general"`, prompt 포함 "refactor") | `prompt.ts:561-585` | ✅ |
| 2. `tool.execute.before` hook 발화 (`input.tool === "task"` 조건) | `opencode-advisor.ts:139` | ✅ |
| 3. `resolveAgent()` — keyword "refactor" 매칭 → `cfg.advisor_agent` 반환 | `opencode-advisor.ts:81-85` | ✅ |
| 4. Hook이 `output.args.subagent_type = target` mutation | `opencode-advisor.ts:153` | ✅ |
| 5. opencode가 `.opencode/agents/powerful.md` 로드 → `model: github-copilot/claude-opus-4.6` | `.opencode/agents/powerful.md:3` | ✅ |
| **핵심 단절**: cfg.advisor_agent가 현재 `"general"`이어서 step 3에서 `"powerful"` 대신 `"general"` 반환 | `advisor-config.json:2` | ❌ |

**실제 현재 동작**: step 3에서 `resolveAgent()`가 `"general"`을 반환하고, step 4에서 `output.args.subagent_type = "general"` (변경 없음) → opus 모델로 라우팅되지 않음

---

## 실패 항목 상세

### ❌ F-1: `advisor-config.json` — agent 이름 미업데이트 (최우선 수정 필요)

- **위치**: `.opencode/plugins/advisor-config.json` lines 2–4
- **기대**:
  ```json
  "advisor_agent": "powerful",
  "executor_agent": "fast",
  "debug": true,
  ```
- **실제**:
  ```json
  "advisor_agent": "general",
  "executor_agent": "general",
  "debug": false,
  ```
- **수정 방향**: advisor_agent → `"powerful"`, executor_agent → `"fast"`, debug → `true` 로 변경
- **영향**: 이 수정 없이는 에이전트 파일(powerful.md, fast.md)이 생성되어 있어도 라우팅이 전혀 작동하지 않음

---

### ❌ F-2: `opencode-advisor.ts` — `validateAgents()` 함수 미구현

- **위치**: `.opencode/plugins/opencode-advisor.ts` (전체 파일 — 해당 함수 없음)
- **기대**: 플러그인 초기화 시 `existsSync`로 `.opencode/agents/{name}.md` 존재 여부 확인, 실패 시 `{}` 반환
  ```typescript
  import { existsSync, readFileSync } from "fs"
  
  function validateAgents(dir: string, cfg: AdvisorConfig): boolean {
    const BUILTIN = ["general", "explore", "build", "plan", "debug"]
    for (const name of [cfg.advisor_agent, cfg.executor_agent]) {
      if (BUILTIN.includes(name)) continue
      const agentPath = join(dir, ".opencode", "agents", `${name}.md`)
      if (!existsSync(agentPath)) {
        return false
      }
    }
    return true
  }
  ```
- **실제**: `existsSync`가 import되지 않음, `validateAgents` 함수 없음
- **수정 방향**:
  1. `import { existsSync, readFileSync } from "fs"` 로 import 교체
  2. `validateAgents()` 함수 추가
  3. 플러그인 엔트리포인트에서 `if (!validateAgents(ctx.directory, cfg)) { if (cfg.debug) console.warn(...); return {}; }` 추가

---

### ❌ F-3: `opencode.jsonc` — 주석 처리된 agent 섹션 잔존

- **위치**: `.opencode/opencode.jsonc` lines 15–34
- **기대**: 해당 주석 블록 완전 제거, clean minimal config
- **실제**:
  ```jsonc
  // ─── 에이전트별 모델 매핑 ────────────────────────────────────────────────
  //
  // advisor_agent / executor_agent 이름을 advisor-config.json과 일치시켜야 함
  // ...
  // "agent": {
  //   "powerful": { ... },
  //   "fast": { ... }
  // }
  ```
- **수정 방향**: lines 15–34 (에이전트 매핑 주석 블록 전체)를 제거. `.opencode/agents/` 파일 기반 새 방식이 적용되므로 opencode.jsonc의 agent 섹션은 불필요.

---

### ❌ F-4: `plugin-dev.md` — "Go PR" 표현 잔존

- **위치**: `.opencode/agents/plugin-dev.md` line 38
- **기대**: "Go PR" → "TypeScript 코어 수정 필요" 또는 "opencode 코어 수정 PR"
- **실제**: `리더에게 Go PR 필요성 보고`
- **수정 방향**: `리더에게 opencode 코어 수정(TypeScript PR) 필요성 보고`

---

### ❌ F-5: `plugin-qa.md` — "Go 코드" 표현 잔존

- **위치**: `.opencode/agents/plugin-qa.md` line 19
- **기대**: `TypeScript 코드의 실제 구조와 플러그인 코드가 일치하는지`
- **실제**: `Go 코드의 실제 구조와 플러그인 코드가 일치하는지`
- **수정 방향**: "Go 코드" → "TypeScript 코드"

---

### ❌ F-6: `opencode-research/SKILL.md` — Go 참조 및 경로 다수 미업데이트

- **위치**: `.opencode/skills/opencode-research/SKILL.md` (다수 라인)
- **기대**: 모든 Go 참조 → TypeScript로, `internal/` 경로 → `packages/opencode/src/`로 업데이트
- **실제 잔존 문제 (주요)**:

  | 라인 | 현재 | 기대 |
  |------|------|------|
  | 3 (description) | `"opencode Go 코드베이스를..."` | `"opencode TypeScript 코드베이스를..."` |
  | 6 (제목) | `# OpenCode Go 코드베이스 탐색 가이드` | `# OpenCode TypeScript 코드베이스 탐색 가이드` |
  | 8 | `opencode의 Go 소스에서` | `opencode의 TypeScript 소스에서` |
  | 18 | `Go 모듈 구조(\`go.mod\`, \`main.go\`)와 주요 패키지(\`internal/\`, \`pkg/\`, \`cmd/\`)` | `패키지 구조(\`package.json\`, \`turbo.json\`)와 주요 디렉토리(\`packages/opencode/src/\`)` |
  | 21 | `` `internal/tool/` `` | `` `packages/opencode/src/tool/` `` |
  | 22 | `` `internal/llm/` `` | `` `packages/opencode/src/session/` `` |
  | 23 | `` `internal/plugin/` `` | `` `packages/opencode/src/plugin/` `` |
  | 24 | `` `internal/config/` `` | `` `packages/opencode/src/config/` `` |
  | 56 | `Task tool args의 Go struct 전체 정의` | `Task tool args의 TypeScript 타입 전체 정의` |
  | 93 | `handler 시그니처: {Go 코드}` | `handler 시그니처: {TypeScript 타입}` |
  | 102 | `struct: {Go 코드}` | `type: {TypeScript 타입}` |
  | 103 | `model 필드: {Yes/No}` | (동일 유지 가능) |
  | 126 | `Go 코드의 interface는 구현체를 반드시 찾아 확인하라` | `TypeScript의 interface는 구현체를 반드시 찾아 확인하라` |

- **수정 방향**: SKILL.md 전체에서 "Go" → "TypeScript", `internal/` → `packages/opencode/src/`, Go 코드 관련 용어 → TypeScript 용어로 일괄 교체

---

## 우선순위별 수정 요약

### 🚨 P0 — 즉시 수정 필요 (라우팅이 현재 작동하지 않음)

1. **F-1**: `advisor-config.json` — `advisor_agent: "powerful"`, `executor_agent: "fast"`, `debug: true` 업데이트
2. **F-2**: `opencode-advisor.ts` — `existsSync` import 및 `validateAgents()` 함수 추가

### ⚠️ P1 — 스펙 불일치 (기능에 영향)

3. **F-3**: `opencode.jsonc` — 주석 처리된 agent 섹션 제거 (clean config)

### 📝 P2 — 문서 수정 (기능 영향 없음)

4. **F-4**: `plugin-dev.md` line 38 — "Go PR" → "TypeScript PR"
5. **F-5**: `plugin-qa.md` line 19 — "Go 코드" → "TypeScript 코드"
6. **F-6**: `opencode-research/SKILL.md` — Go 참조 및 경로 전체 업데이트

---

## 전체 판정

### ❌ FAIL — 조건부 (P0 수정 후 재검증 필요)

**핵심 이유**: P0 항목 2개(F-1, F-2)가 수정되지 않으면 라우팅이 작동하지 않음.

- `advisor-config.json`이 여전히 `"general"` 에이전트를 가리켜서, 정성껏 만든 `powerful.md`/`fast.md`가 실제로 호출되지 않음
- `validateAgents()` 가 없어서 스펙에서 요구한 에이전트 파일 존재 검증 및 graceful fallback 로직이 없음

**현재 상태에서 실제 동작**:
```
LLM: subagent_type="general", prompt="refactor..."
→ hook 발화 → resolveAgent() → "general" 반환 (cfg.advisor_agent="general")
→ output.args.subagent_type = "general" (변화 없음)
→ 결국 general 에이전트 실행 (라우팅 없음)
```

**P0 수정 후 예상 동작**:
```
LLM: subagent_type="general", prompt="refactor..."
→ hook 발화 → resolveAgent() → "powerful" 반환 (cfg.advisor_agent="powerful")
→ output.args.subagent_type = "powerful"
→ .opencode/agents/powerful.md 로드 → model: github-copilot/claude-opus-4.6
→ Opus 모델로 서브에이전트 실행 ✅
```
