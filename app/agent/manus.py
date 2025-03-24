from pydantic import Field

from app.agent.browser import BrowserAgent
from app.config import config
from app.prompt.browser import NEXT_STEP_PROMPT as BROWSER_NEXT_STEP_PROMPT
from app.prompt.manus import NEXT_STEP_PROMPT, SYSTEM_PROMPT
from app.tool import Terminate, ToolCollection
from app.tool.browser_use_tool import BrowserUseTool
from app.tool.python_execute import PythonExecute
from app.tool.str_replace_editor import StrReplaceEditor


class Manus(BrowserAgent):
    """
    A versatile general-purpose agent that uses planning to solve various tasks.
    """

    name: str = "Manus"
    description: str = (
        "A versatile agent that can solve various tasks using multiple tools"
    )

    system_prompt: str = SYSTEM_PROMPT.format(directory=config.workspace_root)
    next_step_prompt: str = NEXT_STEP_PROMPT

    max_observe: int = 10000
    max_steps: int = 20

    available_tools: ToolCollection = Field(
        default_factory=lambda: ToolCollection(
            PythonExecute(), BrowserUseTool(), StrReplaceEditor(), Terminate()
        )
    )

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.websocket = None  # WebSocket for real-time updates

    def set_websocket(self, websocket):
        """Set the WebSocket connection."""
        self.websocket = websocket

    async def send_update(self, message):
        """Send an update via WebSocket."""
        if self.websocket:
            await self.websocket.send_json({"type": "update", "message": message})

    async def think(self) -> bool:
        """Process current state and send real-time updates."""
        # Send initial update
        await self.send_update("🔄 Starting to think...")

        # Existing logic to determine browser context
        original_prompt = self.next_step_prompt
        recent_messages = self.memory.messages[-3:] if self.memory.messages else []
        browser_in_use = any(
            "browser_use" in msg.content.lower()
            for msg in recent_messages
            if hasattr(msg, "content") and isinstance(msg.content, str)
        )

        if browser_in_use:
            self.next_step_prompt = BROWSER_NEXT_STEP_PROMPT
            await self.send_update("🌐 Browser context detected.")

        # Call parent's think method
        result = await super().think()

        # Restore original prompt and send completion update
        self.next_step_prompt = original_prompt
        await self.send_update("✅ Step completed.")

        return result
