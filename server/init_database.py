from app.config import Config
from app.db import ensure_database_indexes, init_db


def _config_mapping():
    return {
        name: getattr(Config, name)
        for name in dir(Config)
        if name.isupper()
    }


def main():
    config = _config_mapping()
    init_db(config=config)
    ensure_database_indexes(config=config)


if __name__ == "__main__":
    main()
