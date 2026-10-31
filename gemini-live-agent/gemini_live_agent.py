"""
Gemini Live API Real-Time Voice Agent with Non-Blocking Function Calling.

Uses Google GenAI SDK (google-genai >= 2.3.0).
Demonstrates:
  1. Bidirectional real-time audio streaming (PCM 16kHz in, 24kHz out).
  2. Non-blocking asynchronous tool execution (`behavior="NON_BLOCKING"`).
  3. Conversational fillers spoken by Gemini while tools run in the background.
  4. Lifecycle tracking via `interaction_status` ('IN_PROGRESS' vs 'IDLE').
  5. Immediate interruption handling (`interrupted: True`).
"""

import asyncio
import os
import sys
import time
from typing import Any, Dict

try:
    from google import genai
    from google.genai import types
except ImportError:
    print(
        "Error: google-genai package is not installed.\n"
        "Please run: pip install -U google-genai"
    )
    sys.exit(1)

# Default to Gemini 3.8 Live Extended Thinking for conversational fillers + background reasoning
MODEL_NAME = "gemini-3.8-live-extended-thinking"


# ---------------------------------------------------------------------------
# Tool Declarations with behavior="NON_BLOCKING"
# ---------------------------------------------------------------------------

check_availability_tool = types.FunctionDeclaration(
    name="check_ticket_availability",
    description=(
        "Checks real-time concert ticket availability, remaining seats per zone, "
        "venue, and event dates for ThaiTicketHub."
    ),
    behavior="NON_BLOCKING",  # Critical: non-blocking function execution
    parameters={
        "type": "OBJECT",
        "properties": {
            "event_name": {
                "type": "STRING",
                "description": "Concert or artist name (e.g. Echoes of Asia, K-Pop Festival)",
            },
            "zone": {
                "type": "STRING",
                "description": "Optional seating zone: VIP, Zone A, Zone B, Zone C",
            },
        },
        "required": ["event_name"],
    },
)

calculate_quote_tool = types.FunctionDeclaration(
    name="calculate_booking_quote",
    description=(
        "Calculates price breakdown, promotional discounts, and 7% VAT for "
        "ticket reservations."
    ),
    behavior="NON_BLOCKING",  # Critical: non-blocking function execution
    parameters={
        "type": "OBJECT",
        "properties": {
            "event_name": {"type": "STRING", "description": "Concert name"},
            "zone": {"type": "STRING", "description": "Seating zone (VIP, Zone A, B, C)"},
            "ticket_count": {
                "type": "INTEGER",
                "description": "Number of tickets (1-6)",
            },
            "promo_code": {
                "type": "STRING",
                "description": "Optional discount promo code",
            },
        },
        "required": ["event_name", "zone", "ticket_count"],
    },
)

lookup_reservation_tool = types.FunctionDeclaration(
    name="lookup_reservation_status",
    description="Looks up customer booking and payment status by order reference.",
    behavior="NON_BLOCKING",
    parameters={
        "type": "OBJECT",
        "properties": {
            "order_ref": {
                "type": "STRING",
                "description": "Order reference code (e.g. TKT-2026-0001)",
            }
        },
        "required": ["order_ref"],
    },
)

TOOLS = [
    types.Tool(
        function_declarations=[
            check_availability_tool,
            calculate_quote_tool,
            lookup_reservation_tool,
        ]
    )
]


# ---------------------------------------------------------------------------
# Asynchronous Tool Implementation (Simulates API / DB queries)
# ---------------------------------------------------------------------------

async def execute_tool_async(name: str, args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Executes tool in the background. While this sleeps/queries, the Gemini
    Live model continues streaming spoken conversational fillers to the user.
    """
    start_time = time.time()
    print(f"\n[Tool Executing Async] {name}({args}) ...")

    # Simulate realistic database query latency (800ms)
    await asyncio.sleep(0.8)

    if name == "check_ticket_availability":
        event = args.get("event_name", "Echoes of Asia")
        result = {
            "event_name": event,
            "venue": "Impact Arena Muang Thong Thani",
            "date": "14-15 November 2026",
            "available_zones": {
                "VIP": {"remaining": 50, "price_thb": 6500},
                "Zone_A": {"remaining": 100, "price_thb": 4500},
                "Zone_B": {"remaining": 120, "price_thb": 3000},
                "Zone_C": {"remaining": 150, "price_thb": 1800},
            },
            "status": "Tickets on sale",
        }
    elif name == "calculate_booking_quote":
        count = int(args.get("ticket_count", 1))
        zone = str(args.get("zone", "Zone A")).upper()
        unit_price = 4500
        if "VIP" in zone:
            unit_price = 6500
        elif "B" in zone:
            unit_price = 3000
        elif "C" in zone:
            unit_price = 1800

        subtotal = count * unit_price
        discount = 0
        code = str(args.get("promo_code", "")).upper()
        if code in ("EARLYBIRD", "LIGHT2026"):
            discount = int(subtotal * 0.15)

        vat = int((subtotal - discount) * 0.07)
        total = (subtotal - discount) + vat

        result = {
            "ticket_count": count,
            "unit_price_thb": unit_price,
            "subtotal_thb": subtotal,
            "discount_thb": discount,
            "vat_thb": vat,
            "total_thb": total,
            "payment_qr": "PromptPay QR Available",
        }
    elif name == "lookup_reservation_status":
        ref = args.get("order_ref", "")
        result = {
            "ref": ref,
            "status": "CONFIRMED_AND_PAID",
            "event": "ECHOES OF ASIA WORLD TOUR 2026",
            "zone": "VIP",
            "qty": 2,
            "qr_code_ready": True,
        }
    else:
        result = {"error": f"Unknown tool: {name}"}

    duration_ms = int((time.time() - start_time) * 1000)
    print(f"[Tool Finished] {name} completed in {duration_ms}ms.")
    return result


# ---------------------------------------------------------------------------
# Background Task Dispatcher for Non-Blocking Function Calling
# ---------------------------------------------------------------------------

async def handle_tool_call_non_blocking(session, call):
    """
    Runs asynchronous tool execution and sends back the tool response
    without blocking the session's receive loop or speech stream.
    """
    call_id = call.id
    name = call.name
    args = call.args or {}

    # Run the background async function
    result = await execute_tool_async(name, args)

    # Send function response back to Gemini Live session
    response = types.FunctionResponse(
        id=call_id,
        name=name,
        response=result,
    )
    await session.send_tool_response(function_responses=[response])
    print(f"[Tool Response Sent] Sent response for {name} (id: {call_id})")


# ---------------------------------------------------------------------------
# Main Agent Loop
# ---------------------------------------------------------------------------

async def run_voice_agent():
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        print("Please set your GEMINI_API_KEY environment variable.")
        return

    client = genai.Client(api_key=api_key)

    config = types.LiveConnectConfig(
        response_modalities=[types.Modality.AUDIO],
        system_instruction=types.Content(
            parts=[
                types.Part(
                    text=(
                        "You are the official ThaiTicketHub AI Voice Concierge. "
                        "You provide friendly, real-time voice assistance for concert "
                        "ticketing, seating zones, and price calculations.\n\n"
                        "NON-BLOCKING FUNCTION CALLING:\n"
                        "- When a user requests availability or pricing calculations, "
                        "IMMEDIATELY speak natural conversational fillers (e.g. 'Let me "
                        "check Zone A seats for Echoes of Asia for you right now...') "
                        "while the tool processes in the background.\n"
                        "- Do not remain silent while waiting for tool calls.\n"
                        "- When the tool result arrives, smoothly incorporate the factual "
                        "details into your voice response.\n"
                        "- Keep responses natural, concise, and optimized for spoken dialogue."
                    )
                )
            ]
        ),
        speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name="Aoede")
            )
        ),
        thinking_config=types.ThinkingConfig(thinking_level="low"),
        tools=TOOLS,
        input_audio_transcription=types.AudioTranscriptionConfig(),
        output_audio_transcription=types.AudioTranscriptionConfig(),
    )

    print(f"\nConnecting to Gemini Live API ({MODEL_NAME})...")
    async with client.aio.live.connect(model=MODEL_NAME, config=config) as session:
        print("Connected! Live voice agent is ready.\n")

        # Simulate sending initial user question to trigger non-blocking tool flow
        print("Simulating user inquiry: 'Can you check VIP tickets for Echoes of Asia?'")
        await session.send_realtime_input(
            text="Hi! Can you check if there are any VIP tickets left for Echoes of Asia?"
        )

        # Receive loop
        async for message in session.receive():
            # 1. Process server content (audio parts, transcripts, interruption)
            content = message.server_content
            if content:
                # Interruption check
                if content.interrupted is True:
                    print("\n[⚡ Barge-in] User interrupted model! Flushing audio buffer.")

                # Output audio chunks (24kHz PCM)
                if content.model_turn:
                    for part in content.model_turn.parts:
                        if part.inline_data:
                            audio_bytes = part.inline_data.data
                            # In real mic/speaker app: write to audio output stream
                            # Here we indicate receipt of audio frames
                            # print(f"[Audio Frame] {len(audio_bytes)} bytes", end="\r")
                            pass

                # Transcripts
                if content.input_transcription and content.input_transcription.text:
                    print(f"\n[User Speech]: {content.input_transcription.text}")
                if content.output_transcription and content.output_transcription.text:
                    print(f"[Concierge Voice]: {content.output_transcription.text}")

            # 2. Non-blocking tool call received
            if message.tool_call:
                for call in message.tool_call.function_calls:
                    # CRITICAL: Launch tool as background asyncio task so loop continues!
                    asyncio.create_task(handle_tool_call_non_blocking(session, call))

            # 3. Lifecycle tracking via interaction_status
            status = getattr(message, "interaction_status", None)
            if status == "IN_PROGRESS":
                # Agent is reasoning, speaking fillers, or awaiting async tool response
                pass
            elif status == "IDLE":
                print("\n[Status: IDLE] Agent finished turn. Ready for next user voice input.")
                break


if __name__ == "__main__":
    asyncio.run(run_voice_agent())
