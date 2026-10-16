import sys


def main(pt: str) -> int:
    """Runs INSIDE the sandbox container. Loading the weights unpickles them: that is the whole reason this
    process has no network, a read-only root filesystem and a wall-clock limit."""
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (3 << 30, 3 << 30))
    except Exception:  # noqa: BLE001
        pass
    from ultralytics import YOLO
    YOLO(pt).export(format="onnx", simplify=False)  # YOLO26 default head is end-to-end; written next to the weights
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1]))
