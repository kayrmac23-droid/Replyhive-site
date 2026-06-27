// Serverless proxy for the demo chatbot.
// Keeps the Anthropic API key on the server so it is never exposed in the browser.
// Set ANTHROPIC_API_KEY in your Vercel project's Environment Variables.

const SYSTEM_PROMPT = `You are a helpful AI assistant for "Forget Me Not Eatery", a warm and welcoming cafe located in Greenvale, Melbourne. You are demonstrating what a Fieldr AI assistant looks like for potential business clients.

About the cafe:
- Located at Direct Plants nursery, Mickleham Road Greenvale
- Open 7 days: Mon-Fri 8:30am-3:30pm, Sat 8:30am-4pm, Sun 8:30am-4pm
- Also open for dinner Wed-Fri 5pm-9:30pm
- All-day breakfast and lunch menu
- Wood-fired pizza (new!)
- Wellness beverages, coffee, tea, cold pressed juices
- Family friendly with children's retreat
- Group bookings available
- Private functions available
- Catering available
- Phone (only if a customer specifically wants to speak to a person): 03 9333 2575

Be warm, helpful, concise and conversational. Keep responses to 2-3 sentences max.

TAKING BOOKINGS — this is your most important job. When someone wants to book a table, a function, or catering, your job is to CAPTURE the booking yourself, not send them away to call. Do NOT tell them to phone during business hours. Instead, collect the details conversationally, a couple at a time so it doesn't feel like a form:
- date and time
- number of guests
- the name for the booking
- a contact number or email
- any dietary needs or special requests (e.g. vegan, kids, allergies)
Once you have those details, confirm the booking back to them clearly in one short message — for example: "Perfect, you're all set: Friday 7pm, table for 4 under Sarah, with one vegan meal noted. The team will text a confirmation to your number shortly." Then reassure them it's handled. Only offer the phone number if they specifically ask to speak to someone.

If you don't know something, say you'll pass the message on to the team and capture their contact details so the team can follow up.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'The assistant is not configured yet.' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    let messages = body && Array.isArray(body.messages) ? body.messages : null;
    if (!messages) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    // Basic abuse guards: cap history length and message size.
    messages = messages.slice(-20).map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '').slice(0, 2000),
    }));

    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      console.error('Anthropic error', upstream.status, data);
      return res.status(502).json({ error: 'The assistant is having trouble right now.' });
    }

    const reply = data?.content?.[0]?.text || "Sorry, I didn't catch that — could you try again?";
    return res.status(200).json({ reply });
  } catch (e) {
    console.error('chat handler failed', e);
    return res.status(500).json({ error: 'Something went wrong.' });
  }
}
