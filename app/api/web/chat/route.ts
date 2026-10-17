import { NextRequest, NextResponse } from "next/server";
import { handleMessage } from "@/lib/core";
import { InboundMessage } from "@/lib/types";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const userId = body.userId || req.headers.get("x-user-id") || "demo_web_user_1";

    const inbound: InboundMessage = {
      userId,
      type: body.type || "text",
      text: body.text,
      buttonId: body.buttonId,
      selectedId: body.selectedId,
      mediaBytes: body.mediaBytes,
      mimeType: body.mimeType,
    };

    const replies = await handleMessage(inbound);
    return NextResponse.json({ replies });
  } catch (err: any) {
    console.error("Web chat handler error:", err);
    return NextResponse.json(
      {
        replies: [
          {
            text: "Something went wrong. Please try again. / कुछ गड़बड़ हुई, कृपया पुनः प्रयास करें। ⚠️",
            buttons: [{ id: "cmd_menu", title: "🏠 Main Menu" }],
          },
        ],
      },
      { status: 500 }
    );
  }
}
