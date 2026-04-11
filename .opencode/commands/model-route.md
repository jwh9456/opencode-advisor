---
description: "연결된 provider의 모델을 자동 감지하여 3-tier 라우팅 에이전트를 설정합니다"
---

## Task: 모델 라우팅 자동 설정

opencode에 연결된 모델 provider를 감지하고, 3-tier 라우팅 에이전트 파일의 `model:` 필드를 자동 업데이트하세요.

### 1단계: 설정 파일 읽기

아래 파일들을 읽어서 설정된 provider와 모델을 파악하세요:

- `.opencode/opencode.jsonc` (프로젝트 레벨)
- `~/.config/opencode/config.jsonc` (유저 레벨, 있으면)

`provider` 섹션에서 활성화된 provider를 확인하세요.

### 2단계: 모델 티어 매핑

아래 테이블을 참고하여 감지된 provider의 모델을 3개 티어로 매핑하세요:

| Provider | high (복잡한 설계/리팩터링) | medium (구현/디버깅) | low (조회/검색) |
|----------|--------------------------|---------------------|----------------|
| Anthropic | claude-opus-4 | claude-sonnet-4 | claude-haiku-4 |
| GitHub Copilot | github-copilot/claude-opus-4.6 | github-copilot/claude-sonnet-4.6 | github-copilot/claude-haiku-4 |
| OpenAI | o3 | gpt-4.1 | gpt-4.1-mini |
| Google | gemini-2.5-pro | gemini-2.5-flash | gemini-2.5-flash |

- provider에 3개 티어 모델이 모두 없으면, 가용한 모델로 폴백 (예: medium과 low를 같은 모델로)
- 여러 provider가 있으면 사용자에게 어떤 provider를 쓸지 물어보세요

### 3단계: 에이전트 파일 업데이트

아래 3개 파일의 frontmatter `model:` 필드만 변경하세요. 나머지 필드는 그대로 유지합니다:

- `.opencode/agents/powerful.md` → high 티어 모델
- `.opencode/agents/balanced.md` → medium 티어 모델
- `.opencode/agents/fast.md` → low 티어 모델

### 4단계: 결과 확인

변경 전/후를 표로 보여주세요:

```
| Agent    | Before              | After               |
|----------|---------------------|---------------------|
| powerful | (이전 모델)          | (새 모델)            |
| balanced | (이전 모델)          | (새 모델)            |
| fast     | (이전 모델)          | (새 모델)            |
```
