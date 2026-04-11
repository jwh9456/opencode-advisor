---
name: advisor-orchestrator
description: "opencode-advisor 플러그인 빌드를 처음부터 끝까지 조율하는 오케스트레이터. 'advisor 플러그인 만들어줘', 'opencode-advisor 빌드', 'model routing 플러그인 구현', '모델 라우팅 플러그인', 'advisor 구현' 요청 시 반드시 이 스킬을 사용. Go 코드 탐색부터 TypeScript 구현, QA 검증까지 전체 파이프라인을 관리."
---

# OpenCode-Advisor Orchestrator

opencode-advisor 플러그인의 전체 빌드 파이프라인을 조율하는 통합 스킬. 탐색 → 판정 → 구현 → 검증의 5 Phase로 구성.

## 실행 모드: 파이프라인 + 생성-검증 복합 (Phase별 팀 재구성)

## 에이전트 구성

| 에이전트 | 타입 | 모드 | Phase | 역할 | 스킬 | 출력 |
|---------|------|------|-------|------|------|------|
| opencode-explorer | 커스텀 | 서브에이전트 | 2 | Go 코드베이스 분석 | opencode-research | `_workspace/01_explorer_findings.md` |
| plugin-dev | 커스텀 | 에이전트 팀 | 4 | 플러그인 구현 | plugin-implementation | `.opencode/plugins/opencode-advisor.ts` |
| plugin-qa | 커스텀 | 에이전트 팀 | 4 | 품질 검증 | — | `_workspace/04_qa_report.md` |

## 워크플로우

### Phase 1: 준비

1. 작업 디렉토리에 `_workspace/` 생성
2. opencode 리포지토리 클론:
   ```
   Bash: git clone https://github.com/anomalyco/opencode.git _workspace/opencode-src
   ```
3. 클론 성공 확인 (디렉토리 존재 + go.mod 존재)

### Phase 2: 탐색 (서브에이전트)

opencode-explorer는 단독 작업이므로 서브에이전트로 호출한다.

```
Agent(
  prompt: "opencode Go 코드베이스를 분석하라. 리포지토리 경로: _workspace/opencode-src. Skill 도구로 opencode-research를 로드하여 탐색 절차를 따르라. 결과를 _workspace/01_explorer_findings.md에 저장하라.",
  subagent_type: "opencode-explorer",
  model: "opus"
)
```

**완료 확인:** `_workspace/01_explorer_findings.md`가 생성되고, 시나리오 판정(A/B/C)이 포함되어 있는지 Read로 확인.

### Phase 3: 아키텍처 결정 (리더 단독)

`_workspace/01_explorer_findings.md`를 Read하여 시나리오를 판정한다.

| 시나리오 | 조건 | 다음 행동 |
|---------|------|----------|
| **A (최적)** | task tool args에 model 있고, hook에서 수정 반영 | Phase 4 — 6개 모듈 전체 구현 지시 |
| **B (우회)** | model 필드 없지만 다른 개입 경로 존재 | Phase 4 — 우회 경로에 맞게 hook 모듈 수정 지시 |
| **C (제한)** | 기존 API로 불가능 | Phase 4 — config + routing만 구현, hook은 stub. 사용자에게 Go PR 필요 알림 |

판정 결과를 `_workspace/02_scenario_decision.md`에 저장:
```
# Scenario Decision
- 판정: {A/B/C}
- 근거: {explorer findings 요약}
- 구현 범위: {모듈 목록}
- 특이사항: {우회 경로 설명 등}
```

### Phase 4: 구현 + 검증 (에이전트 팀)

plugin-dev와 plugin-qa가 생성-검증 루프를 수행한다.

1. 팀 생성:
   ```
   TeamCreate(
     team_name: "advisor-build-team",
     members: [
       {
         name: "dev",
         agent_type: "plugin-dev",
         model: "opus",
         prompt: "opencode-advisor 플러그인을 구현하라. Skill 도구로 plugin-implementation을 로드하라. _workspace/01_explorer_findings.md와 _workspace/02_scenario_decision.md를 먼저 Read하라. 시나리오 판정에 따라 구현 범위를 조정하라. 모듈 하나를 완성할 때마다 qa에게 SendMessage로 검증을 요청하라."
       },
       {
         name: "qa",
         agent_type: "plugin-qa",
         model: "opus",
         prompt: "opencode-advisor 플러그인의 품질을 검증하라. _workspace/01_explorer_findings.md를 Read하여 Go 코드 구조를 파악하라. dev가 모듈 완성 알림을 보내면 즉시 검증하라. 문제 발견 시 dev에게 구체적 수정 요청을 SendMessage로 보내라. 최종 결과를 _workspace/04_qa_report.md에 저장하라."
       }
     ]
   )
   ```

2. 작업 등록:
   ```
   TaskCreate(tasks: [
     { title: "모듈1: Config Loader 구현", assignee: "dev" },
     { title: "모듈1: Config Loader 검증", assignee: "qa", depends_on: ["모듈1: Config Loader 구현"] },
     { title: "모듈2: Routing Engine 구현", assignee: "dev", depends_on: ["모듈1: Config Loader 검증"] },
     { title: "모듈2: Routing Engine 검증", assignee: "qa", depends_on: ["모듈2: Routing Engine 구현"] },
     { title: "모듈3: Provider Inspector 구현", assignee: "dev", depends_on: ["모듈2: Routing Engine 검증"] },
     { title: "모듈3: Provider Inspector 검증", assignee: "qa", depends_on: ["모듈3: Provider Inspector 구현"] },
     { title: "모듈4: Hook Integration 구현", assignee: "dev", depends_on: ["모듈3: Provider Inspector 검증"] },
     { title: "모듈4: Hook Integration 검증", assignee: "qa", depends_on: ["모듈4: Hook Integration 구현"] },
     { title: "모듈5: System Message 구현", assignee: "dev", depends_on: ["모듈4: Hook Integration 검증"] },
     { title: "모듈6: TUI Commands 구현 (가능 시)", assignee: "dev", depends_on: ["모듈5: System Message 구현"] },
     { title: "최종 통합 검증", assignee: "qa", depends_on: ["모듈5: System Message 구현"] }
   ])
   ```

**팀원 간 통신 규칙:**
- dev → qa: 모듈 완성 시 SendMessage로 검증 요청 (파일 경로 명시)
- qa → dev: 문제 발견 시 SendMessage로 수정 요청 (파일:라인 + 수정 방향)
- 수정-검증 루프: 최대 3회. 3회 후에도 실패하면 qa가 리더에게 보고
- dev는 qa의 검증 통과 후 다음 모듈로 진행

**산출물:**

| 팀원 | 출력 경로 |
|------|----------|
| dev | `.opencode/plugins/opencode-advisor.ts` |
| dev | `.opencode/plugins/config.yaml` |
| dev | `.opencode/package.json` (필요 시) |
| qa | `_workspace/04_qa_report.md` |

**리더 모니터링:**
- TaskGet으로 진행률 확인
- 팀원 유휴 알림 수신 시 상태 확인
- 3회 수정 루프 초과 시 개입

### Phase 5: 정리

1. 팀원들에게 종료 요청 (SendMessage)
2. 팀 정리 (TeamDelete)
3. `_workspace/` 보존
4. 사용자에게 결과 요약 보고:
   ```
   ## opencode-advisor 빌드 결과

   ### 시나리오: {A/B/C}
   ### 생성된 파일:
   - `.opencode/plugins/opencode-advisor.ts` — 메인 플러그인
   - `.opencode/plugins/config.yaml` — 기본 설정
   - `.opencode/package.json` — 의존성 (있는 경우)

   ### QA 결과: {통과 N개 / 실패 M개}
   ### 제한사항: {시나리오 C인 경우 Go PR 필요 등}

   ### 사용법:
   opencode 실행 시 자동 로드됩니다. 설정 수정: `.opencode/plugins/config.yaml`
   ```

## 데이터 흐름

```
[리더]
  │
  ├── Phase 1: _workspace/ 생성, git clone
  │
  ├── Phase 2: Agent(opencode-explorer) → _workspace/01_explorer_findings.md
  │
  ├── Phase 3: Read(findings) → _workspace/02_scenario_decision.md
  │
  ├── Phase 4: TeamCreate(dev, qa)
  │               dev ←SendMessage→ qa
  │               │                   │
  │               ↓                   ↓
  │        opencode-advisor.ts    04_qa_report.md
  │
  └── Phase 5: TeamDelete → 사용자 보고
```

## 에러 핸들링

| 상황 | 전략 |
|------|------|
| git clone 실패 | 사용자에게 URL 확인 요청, 수동 클론 안내 |
| explorer 실패/타임아웃 | 1회 재시도. 재실패 시 시나리오 C로 진행 (보수적) |
| dev 실패 | 리더가 SendMessage로 상태 확인. 특정 모듈에서 막힌 경우 해당 모듈 스킵하고 다음 진행 |
| qa가 3회 루프 후에도 실패 보고 | 해당 항목 "미해결"로 최종 보고서에 기록. 나머지 모듈 계속 진행 |
| dev + qa 모두 실패 | 사용자에게 알리고 진행 여부 확인 |
| 시나리오 C 판정 | 구현 가능 범위만 진행, 최종 보고서에 Go PR 필요 사항 명시 |

## 테스트 시나리오

### 정상 흐름 (시나리오 A)
1. Phase 1: _workspace/ 생성, opencode clone 성공
2. Phase 2: explorer가 task tool args에 model 필드 발견, hook에서 수정 반영 확인
3. Phase 3: 시나리오 A 판정
4. Phase 4: dev가 6개 모듈 순차 구현, qa가 각각 검증 통과
5. Phase 5: 최종 보고서 — 시나리오 A, 전 모듈 통과
6. 예상 결과: `.opencode/plugins/opencode-advisor.ts` + `config.yaml` 생성

### 에러 흐름 (시나리오 C)
1. Phase 1: 정상
2. Phase 2: explorer가 task tool args에 model 필드 없음 확인, hook에서 수정 불가 확인
3. Phase 3: 시나리오 C 판정 → `02_scenario_decision.md`에 기록
4. Phase 4: dev가 모듈 1~2만 구현 (config + routing), 모듈 4는 stub, 모듈 6 스킵
5. Phase 5: 최종 보고서 — 시나리오 C, Go PR 필요 사항 명시, config/routing만 동작
6. 예상 결과: 부분 동작하는 플러그인 + Go PR 가이드
