"""
竞品图案规则拆解系统 API - 主入口
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pathlib import Path

from routers.settings import router as settings_router
from routers.analyze import router as analyze_router
from routers.rules import router as rules_router
from routers.vocabularies import router as vocabularies_router
from routers.prompts import router as prompts_router
from routers.library import router as library_router
from routers.image_gen import router as image_gen_router
from services.rule_store import init_db
from services.image_library_store import init_image_library_db
from services.image_gen_store import init_image_gen_db

app = FastAPI(title="竞品图案规则拆解系统 API")

# CORS 中间件配置
# 显式列出允许的前端 origin（allow_credentials=True 时 Starlette 拒绝通配符 *）
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 静态文件服务：挂载 data/uploads 目录到 /uploads
uploads_dir = Path(__file__).parent / "data" / "uploads"
uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=str(uploads_dir)), name="uploads")

# 静态文件服务：挂载 data/library/images 目录到 /library-images
library_images_dir = Path(__file__).parent / "data" / "library" / "images"
library_images_dir.mkdir(parents=True, exist_ok=True)
app.mount("/library-images", StaticFiles(directory=str(library_images_dir)), name="library-images")

# 静态文件服务：挂载 data/library/thumbnails 目录到 /library-thumbnails
library_thumbnails_dir = Path(__file__).parent / "data" / "library" / "thumbnails"
library_thumbnails_dir.mkdir(parents=True, exist_ok=True)
app.mount("/library-thumbnails", StaticFiles(directory=str(library_thumbnails_dir)), name="library-thumbnails")

# 静态文件服务：挂载 data/gen/images 目录到 /gen-images
gen_images_dir = Path(__file__).parent / "data" / "gen" / "images"
gen_images_dir.mkdir(parents=True, exist_ok=True)
app.mount("/gen-images", StaticFiles(directory=str(gen_images_dir)), name="gen-images")

# 注册路由
app.include_router(settings_router, prefix="/api")
app.include_router(analyze_router, prefix="/api")
app.include_router(rules_router, prefix="/api")
app.include_router(vocabularies_router, prefix="/api")
app.include_router(prompts_router, prefix="/api")
app.include_router(library_router, prefix="/api")
app.include_router(image_gen_router, prefix="/api")


@app.on_event("startup")
async def startup_event():
    """应用启动时初始化数据库"""
    init_db()
    init_image_library_db()
    init_image_gen_db()


@app.get("/")
async def health_check():
    """健康检查路由"""
    return {"status": "ok", "message": "API is running"}
