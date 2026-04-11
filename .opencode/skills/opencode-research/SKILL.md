---
name: opencode-research
description: "opencode TypeScript 코드베이스를 체계적으로 탐색하는 가이드. TypeScript 소스에서 hook 시스템, tool args, model 선택 경로를 분석할 때 반드시 이 스킬을 사용. 'opencode 소스 분석', 'TypeScript 코드 탐색', 'hook 구현 찾기', 'plugin 개입 지점 분석' 요청 시 사용."
---

# OpenCode TypeScript 코드베이스 탐색 가이드

opencode의 TypeScript 소스에서 플러그인 개입 가능 지점을 찾기 위한 체계적 탐색 절차.

## 전제 조건
- opencode 리포지토리가 로컬에 클론되어 있어야 한다
- 리포지토리 URL: https://github.com/anomalyco/opencode

## 탐색 순서

### Step 1: 프로젝트 구조 파악

프로젝트 루트의 디렉토리 구조를 확인한다. TypeScript 모노레포 구조(`package.json`, `turbo.json`)와 주요 패키지(`packages/opencode/src/`)를 파악한다.

핵심 확인:
- `packages/opencode/src/tool/` — 도구 정의 (task/agent 도구 포함)
- `packages/opencode/src/provider/` — LLM 호출 (모델 선택 경로)
- `packages/opencode/src/plugin/` — 플러그인 시스템 (hook 구현)
- `packages/opencode/src/config/` — 설정 구조

### Step 2: Hook 시스템 탐색

**검색 키워드:** `hook`, `event`, `plugin`, `before`, `after`, `emit`, `dispatch`, `listener`, `tool.execute`

1. hook/event 정의 찾기:
   - `tool.execute.before` 문자열이 등장하는 파일 탐색
   - `BeforeExecute`, `before_execute`, `ToolHook` 패턴 탐색

2. hook이 args를 수정하는 코드 경로 추적:
   - hook handler의 반환 타입 확인 (args를 반환하는가?)
   - 반환된 args가 이후 코드에서 사용되는지 확인

3. 기록할 것:
   - hook 등록 방식 (파일, 라인)
   - handler 시그니처 (input/output 타입)
   - args 수정 반영 여부 + 증거 코드

### Step 3: Task Tool (Agent 호출) 분석

**검색 키워드:** `task`, `agent`, `subagent`, `spawn`, `delegate`, `model`, `SubagentType`

1. Task/Agent 도구 정의 찾기:
   - `packages/opencode/src/tool/` 하위에서 task 또는 agent 관련 파일 탐색
   - `subagent_type` 필드가 있는 struct 탐색

2. Task tool의 args struct 찾기:
   - args에 `model` 필드가 있는지 확인
   - args가 어떻게 처리되어 에이전트 생성에 사용되는지 추적

3. 기록할 것:
   - Task tool args의 TypeScript type 전체 정의
   - model 필드 유무
   - args → agent 생성까지의 코드 흐름

### Step 4: 모델 선택 경로 추적

**검색 키워드:** `model`, `provider`, `config`, `ModelID`, `ModelName`, `ProviderID`

1. 모델이 결정되는 코드 경로:
   - config에서 model이 읽히는 지점
   - 에이전트 생성 시 model이 전달되는 경로
   - 최종 LLM 호출 시 model이 사용되는 지점

2. 플러그인이 개입할 수 있는 시점 식별

3. 기록할 것:
   - 모델 결정의 진입점 → 중간 변환 → 최종 호출 지점
   - 각 지점의 파일:라인

### Step 5: Provider/모델 목록 접근

**검색 키워드:** `providers`, `models`, `available`, `list`, `sdk`

1. 플러그인 SDK에서 provider/model 목록에 접근하는 API 찾기
2. config에서 사용자가 설정한 provider 정보 구조 파악

## 산출물 형식

`_workspace/01_explorer_findings.md`에 다음 구조로 저장:

```markdown
# Explorer Findings

## 1. Hook 시스템

### 1.1 tool.execute.before 구현
- 파일: {경로}:{라인}
- handler 시그니처: {TypeScript 코드}
- args 수정 반영: {Yes/No}
- 증거: {코드 스니펫}

### 1.2 사용 가능한 다른 hook
- {hook 이름}: {설명}

## 2. Task Tool Args
- 정의 파일: {경로}:{라인}
- type: {TypeScript 코드}
- model 필드: {Yes/No}
- 전체 필드 목록: {나열}

## 3. 모델 선택 경로
- 진입: {파일:라인} → ... → 최종: {파일:라인}
- 개입 가능 시점: {설명}

## 4. Provider 접근
- config type: {TypeScript 코드}
- SDK API: {있으면 기술}

## 5. 시나리오 판정
- **시나리오 A**: task tool args에 model 필드가 있고, hook에서 수정 가능
  - 판정: {가능/불가능} — {근거}
- **시나리오 B**: model 필드는 없지만 다른 우회 경로 존재
  - 판정: {가능/불가능} — {경로 설명}
- **시나리오 C**: 기존 API로 불가능, opencode 코어 수정(PR) 필요
  - 판정: {해당/비해당} — {필요한 변경 설명}
```

## 주의사항
- 추측하지 마라. 코드에서 증거를 찾아라
- "없다"는 결론도 가치있다. 찾을 수 없었다면 검색한 키워드와 범위를 기록하라
- TypeScript 코드의 type/interface는 구현체를 반드시 찾아 확인하라. interface 정의만으로는 실제 동작을 알 수 없다
- 디렉토리 구조가 예상과 다르면 (`packages/` 구조가 다른 등) 실제 구조를 먼저 파악하고 적응하라
