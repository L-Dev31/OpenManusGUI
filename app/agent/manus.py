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
    name: str = "Manus"
    description: str = "A versatile agent that can solve various tasks using multiple tools"
    system_prompt: str = SYSTEM_PROMPT.format(directory=config.workspace_root)
    next_step_prompt: str = NEXT_STEP_PROMPT
    max_observe: int = 10000
    max_steps: int = 20

    available_tools: ToolCollection = Field(
        default_factory=lambda: ToolCollection(
            PythonExecute(), BrowserUseTool(), StrReplaceEditor(), Terminate()
        )
    )

    async def think(self) -> bool:
        original_prompt = self.next_step_prompt
        recent_messages = self.memory.messages[-3:] if self.memory.messages else []
        browser_in_use = any(
            "browser_use" in msg.content.lower()
            for msg in recent_messages
            if hasattr(msg, "content") and isinstance(msg.content, str)
        )

        if browser_in_use:
            self.next_step_prompt = BROWSER_NEXT_STEP_PROMPT

        result = await super().think()
        self.next_step_prompt = original_prompt
        return result

    async def run(self, prompt: str) -> str:
        if self.memory.messages:
            last_user_message = next(
                (msg.content for msg in reversed(self.memory.messages)
                if msg.role == "user"), None
            )
            if last_user_message and last_user_message.strip().lower() == prompt.strip().lower():
                return "I already addressed this request. Please provide more details or ask a new question."

        result = await super().run(prompt)

        if "Step 1:" in result and "Step 2:" in result:
            steps = result.split("Step ")
            if len(steps) > 1:
                first_step = steps[1].strip()
                return f"Step 1: {first_step}\n\nFor more detailed steps, please specify your goal clearly."

        return result
