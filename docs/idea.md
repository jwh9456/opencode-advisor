# opencode repo
github repo: https://github.com/anomalyco/opencode

# 플러그인 개발 참조 문서
https://opencode.ai/docs/ko/plugins/

# claude code advisor 전략에 관한 글
- ./refernce 폴더 참조
- https://news.hada.io/topic?id=28370
- https://claude.com/blog/the-advisor-strategy

# 내가 만들고 싶은 것
- opencode에서 멀티 에이전트 오케스트레이션시 메인 에이전트와 서브 에이전트가 수행하는 작업의 성격과 요구되는 LLM의 모델 사이즈가 다를 것인데, 매 호출마다 필요한 LLM의 모델 사이즈를 동적으로 재할당하는 플러그인임.

---

1. github repo 클론 후 내부 구조 확인
2. plugin 개발에 필요한 요구사항 산출
	1. PRD가 기반이 되어야함
3. 어드바이저 전략을 구현할 수 있어야 함