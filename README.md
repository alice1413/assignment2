# 서울 전세 인사이트

서울시 열린데이터광장의 부동산 전월세가 OpenAPI를 사용해 최근 3년간 아파트 전세 거래를 집계하고, 자치구별 변화를 보여주는 대시보드입니다.

## 데이터와 빠른 페이지 로딩

Cloudflare 앱은 미리 계산된 `public/data/dashboard-summary.json`을 한 번 불러옵니다. 페이지를 열거나 자치구를 바꿀 때 서울시 API에서 수만 건을 다시 수집하지 않습니다. 이 파일에는 공개 데이터의 집계 결과만 들어 있으며 API 키나 개별 원본 행은 포함하지 않습니다.

요약 파일은 저장소에 포함되어 배포되므로 사이트는 Cloudflare 배포가 끝나면 바로 시각화를 표시합니다. 데이터 기준 시각은 앱 아래에 표시됩니다.

## 데이터 새로고침

저장소 루트에서 Python 3.13 이상으로 실행합니다.

1. 프로젝트 폴더에 로컬 API 키 파일 `.dev.vars`가 있고, `SEOUL_API_KEY=...` 형식인지 확인합니다. 이 파일은 Git에서 제외됩니다.
2. 실행합니다.

   ```powershell
   python scripts/build_dashboard_data.py
   ```

3. 완료되면 `public/data/dashboard-summary.json`이 갱신됩니다. 이 파일을 `main`에 반영하면 Cloudflare가 새 요약 자료를 배포합니다.

스크립트는 서울시 API의 경로 필터를 사용해 자치구·접수연도·아파트 조건으로 자료를 받고, 계약 유형과 최근 3년은 Python에서 확인해 집계합니다. API 키는 로컬 파일에서만 읽으며 출력하지 않습니다.

## 포함 지표

- 최근 3년 아파트 전세 계약 건수
- 보증금 중앙값과 최근 연도 전년 대비 변화율
- 월별 보증금 중앙값
- 연도별 거래 건수
- 거래별 보증금/전용면적 중앙값 (만원/㎡)

유효하지 않은 계약일이나 보증금은 집계에서 제외합니다. 면적 정보가 없거나 유효하지 않은 거래는 면적당 보증금 통계에서 제외합니다.

## Cloudflare 배포

저장소 `alice1413/assignment2`의 `main` 브랜치를 Cloudflare Workers Builds에 연결하고 Root directory를 `.`로 설정합니다. Python Worker 이름은 `wrangler.jsonc`의 `assignment02`입니다.

서울시 API 키는 요약 파일을 다시 만들 때만 로컬 스크립트에서 필요합니다. 공개 앱은 런타임에 API 키를 사용하지 않습니다.

## 데이터 출처

[서울시 부동산 전월세가 정보](https://data.seoul.go.kr/dataList/OA-21276/A/1/datasetView.do), 서울특별시. OpenAPI는 최근 3년 자료를 제공합니다.
