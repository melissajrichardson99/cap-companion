class NotFoundError(Exception):
    """Raised by the service layer when a requested row doesn't exist."""


class ConflictError(Exception):
    """Raised by the service layer when an action conflicts with existing state."""
