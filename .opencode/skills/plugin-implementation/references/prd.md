# opencode-advisor PRD 요약

## 목표
멀티 에이전트 오케스트레이션 환경에서 작업 성격에 따라 LLM 모델 사이즈를 규칙 기반으로 동적 라우팅하여 성능과 비용 효율을 극대화.

## 핵심 아키텍처
- **개입 시점:** tool.execute.before 훅 (PRD 원문의 beforeAgentCall은 존재하지 않음)
- **전략:** 규칙 기반 — LLM 기반 판단 배제
- **상태 관리:** opencode 네이티브 메모리 시스템 100% 활용
- **Provider 검사:** 타겟 모델 불가 시 사용자 기본 모델로 silent fallback

## 라우팅 룰셋

### Tool 기반
| 도구 유형 | 라우팅 |
|----------|--------|
| 단순 I/O (Read, Glob, Grep, Bash) | executor (경량) |
| 코드 변경 (Edit, Write, Agent) | advisor (대형) |

### Keyword 기반
| 키워드 | 라우팅 |
|--------|--------|
| refactor, architect, review, design | advisor |

### Threshold 기반
| 조건 | 라우팅 |
|------|--------|
| 토큰 수 > threshold | advisor (컨텍스트 유실 방지) |

## TUI 명령어
- `/model-route optimize`: 서브 에이전트 LLM 사이즈 일괄 재할당 (세션 한정)
- `/model-route list`: 현재 라우팅 규칙 및 모델 매핑 출력

## 시스템 메시지
```
opencode-advisor: {before} -> {after} 모델 재할당
```

## 설정 스키마
```yaml
default_advisor: "claude-sonnet-4-20250514"
default_executor: "gpt-4o-mini"
rules:
  - type: "tool" | "keyword" | "threshold"
    match: string[]
    target: "advisor" | "executor"
    threshold?: number  # type: threshold일 때
```

## 제약사항 (탐색으로 확인 필요)
- beforeAgentCall 훅이 실제로 존재하지 않음 → tool.execute.before로 우회
- tool.execute.before에서 task tool args의 model을 수정할 수 있는지 미확인
- TUI 커스텀 명령어 등록 방법 미확인
