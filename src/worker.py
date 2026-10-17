from workers import WorkerEntrypoint


class Default(WorkerEntrypoint):
    async def fetch(self, request):
        # The app serves precomputed summaries; page views never call the Seoul API.
        return await self.env.ASSETS.fetch(request)
