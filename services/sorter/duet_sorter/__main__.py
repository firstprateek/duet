import os

import uvicorn


def main() -> None:
    # No access log: descriptions pass through here and should leave no trace.
    uvicorn.run(
        "duet_sorter.app:app",
        host=os.environ.get("DUET_SORTER_HOST", "127.0.0.1"),
        port=int(os.environ.get("DUET_SORTER_PORT", "8788")),
        access_log=False,
        log_level="warning",
    )


if __name__ == "__main__":
    main()
