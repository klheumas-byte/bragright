from flask_cors import CORS


cors = CORS()


def init_extensions(app):
    cors.init_app(
        app,
        resources={r"/api/*": {"origins": app.config.get("CORS_ORIGINS") or app.config["FRONTEND_ORIGIN"]}},
    )
