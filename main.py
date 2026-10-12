import uvicorn
from fastapi import FastAPI, Request, Depends
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from routers.v1.sites_list_router import router as site_list_router
from routers.home_router import router as home_router
from routers.v1.torrentfunk_api_router import router as torrentfunk_api_router
from routers.v1.subplease_api_router import router as subplease_api_router
from helper.uptime import getUptime
from helper.dependencies import authenticate_request
from mangum import Mangum
from math import ceil
import time

startTime = time.time()

app = FastAPI(
    title="Torrent-Api-Py",
    version="1.0.1",
    description="Unofficial Torrent-Api",
    docs_url="/docs",
    contact={
        "name": "Neeraj Kumar",
        "url": "https://github.com/ryuk-me",
        "email": "neerajkr1210@gmail.com",
    },
)

origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_route(req: Request):
    """
    Health Route : Returns App details.

    """
    return JSONResponse(
        {
            "app": "Torrent-Api-Py",
            "version": "v" + "1.0.1",
            "ip": req.client.host,
            "uptime": ceil(getUptime(startTime)),
        }
    )


app.include_router(site_list_router, prefix="/api/v1/sites", dependencies=[Depends(authenticate_request)])
app.include_router(torrentfunk_api_router, prefix="/api/v1/torrentfunk", dependencies=[Depends(authenticate_request)])
app.include_router(subplease_api_router, prefix="/api/v1/subplease", dependencies=[Depends(authenticate_request)])
app.include_router(home_router, prefix="")

handler = Mangum(app)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8009)
