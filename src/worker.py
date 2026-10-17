from urllib.parse import parse_qs, urlsplit

from workers import Response, WorkerEntrypoint
from js import caches

from analytics import build_district_summary
from seoul_api import SeoulApiError, fetch_rent_records


DISTRICTS = [
    "종로구", "중구", "용산구", "성동구", "광진구", "동대문구", "중랑구",
    "성북구", "강북구", "도봉구", "노원구", "은평구", "서대문구", "마포구",
    "양천구", "강서구", "구로구", "금천구", "영등포구", "동작구", "관악구",
    "서초구", "강남구", "송파구", "강동구",
]


def json_error(code: str, message: str, status: int) -> Response:
    return Response.json(
        {"error": {"code": code, "message": message}},
        status=status,
        headers={"Cache-Control": "no-store"},
    )


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        url = urlsplit(str(request.url))

        if url.path == "/api/districts":
            return Response.json({"districts": DISTRICTS})

        if url.path == "/api/summary":
            query = parse_qs(url.query)
            district = query.get("district", [""])[0]
            if district not in DISTRICTS:
                return json_error("INVALID_DISTRICT", "자치구를 선택해 주세요.", 400)

            try:
                cached = await caches.default.match(request)
                if cached is not None:
                    return cached
            except Exception:
                # Cache availability must not prevent the live data request.
                pass

            api_key = getattr(self.env, "SEOUL_API_KEY", None)
            if not api_key:
                return json_error(
                    "MISSING_API_KEY",
                    "서버의 서울시 API 키 설정을 확인해 주세요.",
                    503,
                )

            try:
                records = await fetch_rent_records(str(api_key), district)
                summary = build_district_summary(records, district)
                response = Response.json(
                    summary,
                    headers={"Cache-Control": "public, max-age=21600"},
                )
                try:
                    await caches.default.put(request, response.clone())
                except Exception:
                    pass
                return response
            except SeoulApiError as error:
                return json_error(
                    "SEOUL_API_ERROR",
                    f"서울시 API 요청 실패: {error}",
                    502,
                )
            except Exception:
                return json_error(
                    "SUMMARY_ERROR",
                    "분석 결과를 만드는 중 문제가 발생했습니다.",
                    500,
                )

        if url.path.startswith("/api/"):
            return json_error("NOT_FOUND", "요청한 API 경로를 찾을 수 없습니다.", 404)

        return await self.env.ASSETS.fetch(request)
