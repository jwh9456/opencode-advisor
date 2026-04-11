---
name: plugin-implementation
description: "opencode-advisor TypeScript 플러그인 구현 가이드. 설정 로더, 라우팅 엔진, Provider 검사, 훅 연결, 시스템 메시지, TUI 명령어의 6개 모듈 구현. 'opencode 플러그인 구현', 'advisor 플러그인 개발', 'model routing 구현', '모델 라우팅' 요청 시 반드시 이 스킬을 사용."
---

# OpenCode-Advisor 플러그인 구현 가이드

opencode-advisor 플러그인을 TypeScript로 구현하는 가이드. Explorer의 탐색 결과에 따라 3가지 시나리오로 분기한다.

## 시나리오 분기

`_workspace/01_explorer_findings.md`의 시나리오 판정을 먼저 Read로 확인한다.

| 시나리오 | 조건 | 구현 범위 |
|---------|------|----------|
| A (최적) | task tool args에 model 있고, hook에서 수정 반영 | 6개 모듈 전체 |
| B (우회) | model 필드 없지만 다른 개입 경로 존재 | 경로에 맞게 hook 모듈 수정 |
| C (제한) | 기존 API로 불가능 | config + routing만 구현, hook은 stub |

## 모듈 구현 순서

의존성 순서대로 구현한다. 각 모듈 완성 후 plugin-qa에게 검증을 요청한다.

### 모듈 1: 설정 로더 (Config Loader)

**파일:** `.opencode/plugins/opencode-advisor.ts` 내 `loadConfig()` 함수

**입력:** `.opencode/plugins/config.yaml`

**스키마:** `references/prd.md` 참조

```typescript
interface AdvisorConfig {
  default_advisor: string;    // 대형 모델 (기본: "claude-sonnet-4-20250514")
  default_executor: string;   // 경량 모델 (기본: "gpt-4o-mini")
  rules: RoutingRule[];
}

interface RoutingRule {
  type: "tool" | "keyword" | "threshold";
  match: string[];            // tool 이름 또는 keyword
  target: "advisor" | "executor";
  threshold?: number;         // type: "threshold"일 때 토큰 수
}
```

**구현 요점:**
- YAML 파싱: `yaml` npm 패키지 사용 (`.opencode/package.json`에 의존성 선언)
- 파일 없으면 기본값 사용 (에러 아님)
- 스키마 위반 시 경고 로그 + 기본값 폴백

### 모듈 2: 라우팅 엔진 (Routing Engine)

**함수:** `resolveModel(toolName: string, prompt: string, config: AdvisorConfig): string`

**규칙 평가 순서:**
1. threshold 규칙 (토큰 수 > threshold → advisor)
2. tool 규칙 (toolName이 match에 포함 → target 모델)
3. keyword 규칙 (prompt에 match 키워드 포함 → target 모델)
4. 기본값: `config.default_executor`

**구현 요점:**
- 규칙은 배열 순서대로 평가, 첫 매칭에서 중단
- 토큰 수 추정: 단순 문자열 길이 / 4 (정밀 토크나이저 불필요 — YAGNI)

### 모듈 3: Provider 검사 (Provider Inspector)

**함수:** `isModelAvailable(modelId: string, sdk: any): boolean`

**구현 요점:**
- `sdk.config.providers`에서 설정된 provider 목록 확인
- 대상 model의 provider가 설정에 있고 API 키가 존재하는지 확인
- 불가능하면 `false` 반환 → 호출측이 default 모델로 폴백

### 모듈 4: 훅 연결 (Hook Integration)

**시나리오 A 구현:**
```typescript
app.hook("tool.execute.before", async (event) => {
  // task tool인지 확인
  if (event.tool !== "task" && event.tool !== "Agent") return;

  const config = loadConfig();
  const targetModel = resolveModel(
    event.args.subagent_type,
    event.args.prompt,
    config
  );

  if (isModelAvailable(targetModel, sdk)) {
    event.output.args = { ...event.args, model: targetModel };
    logRouting(event.args.model, targetModel);
  }
  // 불가능하면 원본 args 유지 (silent fallback)
});
```

**시나리오 B:** explorer 결과에 따라 hook 대상과 args 수정 방식을 변경.
**시나리오 C:** 이 모듈은 주석 + TODO로 남김.

### 모듈 5: 시스템 메시지 (System Message)

**함수:** `logRouting(before: string, after: string): void`

**출력 형식:**
```
opencode-advisor: {before} -> {after} 모델 재할당
```

**구현 요점:**
- `console.log` 사용 (opencode 플러그인의 로그 출력 방식 따름)
- before === after 이면 출력하지 않음

### 모듈 6: TUI 명령어 (가능한 경우)

**탐색 결과에 따라 구현 여부 결정.** opencode 플러그인 API에서 커스텀 TUI 명령어 등록이 가능한 경우에만 구현.

- `/model-route list`: 현재 config의 규칙 목록 출력
- `/model-route optimize`: (향후 확장 포인트 — 현재는 list와 동일)

**불가능하면:** 이 모듈은 스킵.

## 기본 설정 파일

`.opencode/plugins/config.yaml`:
```yaml
default_advisor: "claude-sonnet-4-20250514"
default_executor: "gpt-4o-mini"
rules:
  - type: "tool"
    match: ["Read", "Glob", "Grep", "Bash"]
    target: "executor"
  - type: "tool"
    match: ["Edit", "Write", "task", "Agent"]
    target: "advisor"
  - type: "keyword"
    match: ["refactor", "architect", "review", "design"]
    target: "advisor"
  - type: "threshold"
    match: []
    target: "advisor"
    threshold: 8000
```

## 플러그인 엔트리포인트 스켈레톤

```typescript
import { definePlugin } from "@opencode/plugin";

export default definePlugin({
  name: "opencode-advisor",
  setup(app) {
    // 모듈 1: config 로드
    // 모듈 4: hook 등록
    // 모듈 6: TUI 명령어 등록 (가능 시)
  }
});
```

## 레퍼런스
- PRD 상세: `references/prd.md` (Read로 로드)
- Plugin API: `references/opencode-plugin-api.md` (Read로 로드)
