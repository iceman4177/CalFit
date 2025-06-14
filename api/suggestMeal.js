export default async function handler(req, res) {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method Not Allowed' });
    }
  
    try {
      const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content: 'Suggest a simple meal with calories. Format: "Chicken Salad – 450 calories". Nothing else.'
            }
          ]
        })
      });
  
      const data = await openaiRes.json();
      const suggestion = data.choices?.[0]?.message?.content || 'No suggestion';
  
      return res.status(200).json({ suggestion });
    } catch (err) {
      console.error(err);
      return res.status(500).json({ error: 'Internal Server Error', details: err.message });
    }
  }
  