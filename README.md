# 서울 전세 인사이트

서울시 열린데이터광장의 전월세 OpenAPI에서 최근 제공되는 자료를 조회해 자치구별 아파트 전세 거래 변화를 보여주는 대시보드입니다. Python Worker가 데이터를 가져오고 집계하며, 정적 웹 화면이 자치구 선택과 차트를 제공합니다.

## 포함 지표

- 최근 API 제공 자료의 계약 건수
- 보증금 중앙값과 최근 연도 전년 대비 변화율
- 월별 보증금 중앙값
- 연도별 거래 건수
- 거래별 보증금/전용면적의 중앙값 (만원/㎡)

보증금과 면적 자료가 유효하지 않은 거래는 해당 통계에서 제외됩니다. 전년 대비 변화율은 비교할 두 연도 자료가 있을 때만 표시됩니다.

## 로컬 실행

필요 도구: Node.js, `uv`.

1. Cloudflare 로컬 실행용 키 파일을 준비합니다. 서울시 API 키는 `SEOUL_API_KEY` 항목만 복사해 `.dev.vars`에 두세요. 이 파일은 Git에서 제외됩니다.

   ```powershell
   $line = Get-Content '..\..\..\.env' | Where-Object { $_ -match '^SEOUL_API_KEY=' }
   if (-not $line) { throw '루트 .env에서 SEOUL_API_KEY를 찾지 못했습니다.' }
   Set-Content -Encoding ascii .dev.vars $line
   ```

2. 개발 서버를 시작합니다.

   ```powershell
   uv run pywrangler dev
   ```

Cloudflare Python Worker는 열린데이터광장 OpenAPI에 서버 측에서 요청하므로 브라우저에는 API 키를 전달하지 않습니다.

> 서울시 OpenAPI 공식 사용 안내의 예시는 `http://openapi.seoul.go.kr:8088` 주소를 사용합니다. Cloudflare Secret은 키를 코드와 저장소에서 보호하지만, 공식 문서에서 HTTPS 지원을 확인하기 전까지는 외부 API 요청의 전송 구간 보호를 보장할 수 없습니다. 공개 배포 전 새로 발급한 키로 이 점을 확인하세요.

## Cloudflare 배포

Cloudflare 계정으로 인증한 뒤 Worker Secret으로 키를 등록하고 배포합니다.

GitHub 연동 빌드를 쓰는 경우 Workers 설정에서 저장소 `alice1413/assignment2`, 브랜치 `main`, Root directory `.`를 지정하세요. Worker 이름은 `assignment02`이며 `wrangler.jsonc`의 `name`과 같아야 합니다. Python Worker를 빌드하려면 Deploy command를 `uv run pywrangler deploy`로 설정하세요.

```powershell
uv run pywrangler secret put SEOUL_API_KEY
uv run pywrangler deploy
```

첫 명령이 요청할 때 키를 입력하세요. 키를 코드, `.dev.vars.example`, README, GitHub에 기록하지 마세요. 배포 URL은 실제 배포가 끝난 뒤 기록합니다.

## 데이터 출처

[서울시 부동산 전월세가 정보](https://data.seoul.go.kr/dataList/OA-21276/S/1/datasetView.do), 서울특별시. 데이터 설명에 따르면 OpenAPI는 최근 3년 자료를 제공합니다. 화면에는 실제 계약일 범위를 표시합니다.

