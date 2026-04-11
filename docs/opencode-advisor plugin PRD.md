# 📄 OpenCode 플러그인 기획서: `opencode-advisor`

## 1. 프로젝트 개요

- **플러그인 명:** `opencode-advisor` (가칭)
    
- **목표:** 멀티 에이전트 오케스트레이션 환경에서, 메인 에이전트(Advisor)와 서브 에이전트(Executor)가 수행하는 작업의 성격과 난이도에 따라 LLM 모델 사이즈를 동적으로 재할당하여 성능과 비용 효율을 극대화한다.
    
- **핵심 전략:** 토큰 낭비가 발생하는 LLM 기반 판단을 배제하고, 가볍고 빠른 **규칙 기반(Rule-based)** 라우팅을 채택한다.
    

## 2. 핵심 아키텍처 및 동작 방식

- **개입 시점 (Hook):** `beforeAgentCall`
    
    - 에이전트가 호출되기 직전의 컨텍스트와 사용하려는 도구(Tool)를 인터셉트하여 룰셋을 검사하고, 호출될 모델 파라미터를 동적으로 변경한다.
        
- **상태 관리 (State Management):**
    
    - OpenCode의 네이티브 메모리 시스템을 100% 그대로 활용한다. 모델이 전환되더라도 기존 컨텍스트 흐름이 끊기지 않도록 통합 안정성을 우선한다.
        
- **Provider 사전 검사 및 조용한 폴백 (Silent Fallback):**
    
    - 실행 전 사용자가 현재 OpenCode에 연결해 둔 Provider(OpenAI, Anthropic 등)와 사용 가능한 모델 목록을 미리 확인한다.
        
    - 만약 라우팅해야 할 타겟 모델의 API 키가 없거나 접근 불가능한 상태라면, 에러를 띄우지 않고 **사용자의 기본(Default) 모델로 조용히 폴백**하여 작업을 중단 없이 진행한다.
        

## 3. 라우팅 룰셋 (규칙 기반)

설정 파일에 정의된 규칙에 따라 작동하며, 주로 다음과 같은 기준을 따른다.

- **도구(Tool) 기반 라우팅:**
    
    - 단순 I/O 및 검색 (예: `cat`, `ls`, `grep`) -> 경량 모델 (Executor)
        
    - 코드 작성, 아키텍처 변경, 복잡한 쉘 실행 -> 대형 모델 (Advisor)
        
- **컨텍스트 볼륨 (Threshold):**
    
    - 처리해야 할 프롬프트나 파일의 토큰 수가 설정된 임계값을 초과할 경우, 컨텍스트 유실 방지를 위해 대형 모델로 강제 할당.
        

## 4. 사용자 인터페이스 (TUI 명령어)

플러그인 설정을 복잡하게 만들지 않고, TUI 내에서 즉각적으로 제어할 수 있는 심플한 명령어를 제공한다.

- `/model-route optimize`: 현재 세션의 압축된 컨텍스트(compact result)를 기반으로, 호출 가능한 서브 에이전트들의 LLM 사이즈를 수동으로 일괄 재할당한다. (해당 세션에만 적용)
    
- `/model-route list`: 현재 적용된 라우팅 규칙 및 모델 매핑 상태를 간략히 출력한다.
    

## 5. 시스템 로깅 및 메시지

비용 계산 등의 무거운 UI 대신, 모델이 재할당될 때마다 사용자가 직관적으로 인지할 수 있는 깔끔한 시스템 메시지를 출력한다.

- **출력 포맷:**
    
    > 💡 _opencode-advisor에 의해 실행계획 모델이 {before}에서 {after}로 재할당됨._
    > 
    > `[System] Delegated {agent} as {model}`
    

## 6. 설정 파일 구조 (`config.yaml`)

사용자가 프로젝트 성격에 맞춰 쉽게 수정할 수 있는 직관적인 스키마를 제공한다.

YAML

```
default_advisor: "claude-3-5-sonnet-20241022"
default_executor: "gpt-4o-mini"
rules:
  - type: "tool"
    match: ["ls", "cat", "grep", "read_file"]
    target: "executor"
  - type: "keyword"
    match: ["refactor", "architect", "review"]
    target: "advisor"
```