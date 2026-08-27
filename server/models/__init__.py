from models.conversation import Conversation  # noqa: F401
from models.project import Project  # noqa: F401
from models.review_item import ReviewItem  # noqa: F401
from models.artifact import Artifact, ArtifactRevision  # noqa: F401
from models.message import Message  # noqa: F401
from models.todo import Todo  # noqa: F401
from models.task_relationship import TaskRelationship  # noqa: F401
from models.data_migration_marker import DataMigrationMarker  # noqa: F401
from models.task_graph_state import TaskGraphState  # noqa: F401
from models.plan_proposal import PlanProposal  # noqa: F401
from models.change_set import ChangeSet  # noqa: F401
from models.vault_sync_job import VaultSyncJob  # noqa: F401
from models.event import Event  # noqa: F401
from models.agent_task import AgentTask  # noqa: F401
from models.agent_run import AgentRun, AgentRunEvent  # noqa: F401
from models.user_settings import UserSettings  # noqa: F401
from models.attachment import Attachment  # noqa: F401
from models.paired_device import PairedDevice, PairingSession  # noqa: F401
from models.host_identity import HostIdentity  # noqa: F401
from models.refresh_session import RefreshSession  # noqa: F401

# Sentinel used by database.init_db to ensure all models are imported
_register_all = True
