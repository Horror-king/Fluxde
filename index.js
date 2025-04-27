const express = require('express');
const axios = require('axios');
const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const config = {
  API_KEY: '03329d43f2ab98fb3eee4d54ab6e103235868e551acfa04cdd3222e5ca2cb5cf',
  API_URL: 'https://api.wavespeed.ai/api/v2/wavespeed-ai/flux-dev-ultra-fast',
  MAX_PROMPT_LENGTH: 500,
  DEFAULT_SIZE: '1024*1024', // CHANGED FROM x TO *
  DEFAULT_STEPS: 28,
  POLL_INTERVAL: 2000,
  MAX_POLL_ATTEMPTS: 60
};

async function checkPredictionStatus(predictionId) {
  let attempts = 0;
  
  while (attempts < config.MAX_POLL_ATTEMPTS) {
    attempts++;
    try {
      const response = await axios.get(
        `https://api.wavespeed.ai/api/v2/predictions/${predictionId}/result`,
        {
          headers: {
            'Authorization': `Bearer ${config.API_KEY}`
          },
          timeout: 10000
        }
      );

      console.log(`Poll ${attempts}: Status ${response.data.data?.status || 'unknown'}`);
      
      if (response.data.data?.status === 'completed') {
        if (response.data.data?.outputs?.length > 0) {
          return {
            imageUrl: response.data.data.outputs[0],
            fullResponse: response.data
          };
        }
        throw new Error('No outputs in completed prediction');
      }
      else if (response.data.data?.status === 'failed') {
        throw new Error(response.data.data?.error || 'API reported failure');
      }
      
      await new Promise(resolve => setTimeout(resolve, config.POLL_INTERVAL));
    } catch (error) {
      console.error('Poll error:', error.message);
      if (error.code === 'ECONNABORTED') {
        await new Promise(resolve => setTimeout(resolve, config.POLL_INTERVAL));
        continue;
      }
      throw error;
    }
  }
  
  throw new Error('Timeout waiting for image generation');
}

app.get('/generate', async (req, res) => {
  try {
    const prompt = req.query.prompt;
    
    // Validate prompt
    if (!prompt) {
      return res.status(400).json({ 
        error: 'Prompt required',
        message: 'Add ?prompt=description to the URL'
      });
    }

    if (prompt.length > config.MAX_PROMPT_LENGTH) {
      return res.status(400).json({
        error: 'Prompt too long',
        message: `Max ${config.MAX_PROMPT_LENGTH} characters allowed`
      });
    }

    console.log('Starting generation:', prompt.substring(0, 50) + (prompt.length > 50 ? '...' : ''));
    const startTime = Date.now();

    // Start generation
    const response = await axios.post(config.API_URL, {
      num_images: 1,
      num_inference_steps: config.DEFAULT_STEPS,
      prompt: prompt,
      seed: -1,
      size: config.DEFAULT_SIZE // Now using correct format 1024*1024
    }, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.API_KEY}`
      },
      timeout: 30000
    });

    if (!response.data.data?.id) {
      console.error('Invalid response:', response.data);
      throw new Error('API did not return prediction ID');
    }

    // Wait for completion
    const { imageUrl, fullResponse } = await checkPredictionStatus(response.data.data.id);
    const generationTime = Date.now() - startTime;

    return res.json({
      success: true,
      image_url: imageUrl,
      metadata: {
        prediction_id: response.data.data.id,
        time_taken: `${generationTime}ms`,
        inference_time: `${fullResponse.data.timings?.inference || 'unknown'}ms`,
        created_at: fullResponse.data.created_at
      }
    });

  } catch (error) {
    console.error('Final error:', error.message);
    let statusCode = 500;
    let suggestion = 'Please try again later';
    
    if (error.message.includes('size') || error.message.includes('1024')) {
      statusCode = 400;
      suggestion = 'Invalid image size parameter';
    } else if (error.message.includes('prompt')) {
      statusCode = 400;
      suggestion = 'Please check your prompt text';
    }

    res.status(statusCode).json({
      success: false,
      error: 'Generation failed',
      details: error.message,
      suggestion: suggestion
    });
  }
});

app.get('/', (req, res) => {
  res.json({
    service: 'Wavespeed AI Image API',
    endpoints: {
      generate: {
        method: 'GET',
        url: '/generate?prompt=YOUR_TEXT',
        parameters: {
          prompt: 'Description of desired image',
          notes: 'Max 500 characters, generates 1024x1024 images'
        },
        example: `http://localhost:${PORT}/generate?prompt=a%20sunset%20over%20mountains`
      }
    }
  });
});

app.listen(PORT, () => {
  console.log(`Server ready at http://localhost:${PORT}`);
  console.log(`Try: http://localhost:${PORT}/generate?prompt=a%20colorful%20parrot`);
});