"""Exit codes and error types for the CLI."""

from __future__ import annotations

# Exit codes per plan spec
EXIT_OK = 0
EXIT_INPUT_ERROR = 2
EXIT_AUTH_ERROR = 3
EXIT_SERVER_ERROR = 4
EXIT_NOT_FOUND = 5


class ClawError(Exception):
    """Base error with an exit code."""

    def __init__(self, message: str, exit_code: int = 1):
        super().__init__(message)
        self.exit_code = exit_code


class InputError(ClawError):
    def __init__(self, message: str):
        super().__init__(message, EXIT_INPUT_ERROR)


class AuthError(ClawError):
    def __init__(self, message: str):
        super().__init__(message, EXIT_AUTH_ERROR)


class ServerError(ClawError):
    def __init__(self, message: str):
        super().__init__(message, EXIT_SERVER_ERROR)


class NotFoundError(ClawError):
    def __init__(self, message: str):
        super().__init__(message, EXIT_NOT_FOUND)
