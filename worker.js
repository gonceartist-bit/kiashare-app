// worker.js - Cloudflare Worker for HTTP-based file sharing
// Deploy this to Cloudflare Workers

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers - allow all origins for simplicity
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-File-Index, X-Chunk-Index, X-Total-Chunks, X-File-Name',
      'Access-Control-Expose-Headers': 'Content-Disposition',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // API: Create upload session (returns code)
    if (path === '/api/create' && request.method === 'POST') {
      const code = generateCode();
      const data = await request.json().catch(() => ({}));

      // Store metadata in KV with 10 minute expiry
      await env.KIASHARE_KV.put(`meta:${code}`, JSON.stringify({
        files: data.files || [],
        created: Date.now(),
        expires: Date.now() + 10 * 60 * 1000, // 10 minutes
        totalSize: data.totalSize || 0,
        fileCount: data.fileCount || 0
      }), { expirationTtl: 600 });

      return new Response(JSON.stringify({ 
        code, 
        uploadUrl: `${url.origin}/api/upload/${code}`,
        statusUrl: `${url.origin}/api/status/${code}`
      }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // API: Upload a file chunk
    if (path.startsWith('/api/upload/') && request.method === 'POST') {
      const code = path.split('/').pop();
      const fileIndex = request.headers.get('X-File-Index') || '0';
      const chunkIndex = request.headers.get('X-Chunk-Index') || '0';
      const totalChunks = request.headers.get('X-Total-Chunks') || '1';
      const fileName = decodeURIComponent(request.headers.get('X-File-Name') || 'file');

      // Store chunk in R2
      const chunkKey = `chunk:${code}:${fileIndex}:${chunkIndex}`;
      await env.KIASHARE_R2.put(chunkKey, request.body);

      // Track uploaded chunks
      const metaKey = `upload:${code}:${fileIndex}`;
      let uploaded = await env.KIASHARE_KV.get(metaKey);
      uploaded = uploaded ? JSON.parse(uploaded) : { chunks: [], fileName, totalChunks: parseInt(totalChunks), mimeType: request.headers.get('Content-Type') || 'application/octet-stream' };
      uploaded.chunks.push(parseInt(chunkIndex));
      await env.KIASHARE_KV.put(metaKey, JSON.stringify(uploaded), { expirationTtl: 600 });

      return new Response(JSON.stringify({ 
        uploaded: uploaded.chunks.length, 
        total: parseInt(totalChunks),
        complete: uploaded.chunks.length >= parseInt(totalChunks)
      }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // API: Check status / list files
    if (path.startsWith('/api/status/') && request.method === 'GET') {
      const code = path.split('/').pop();
      const meta = await env.KIASHARE_KV.get(`meta:${code}`);

      if (!meta) {
        return new Response(JSON.stringify({ error: 'Not found or expired' }), { 
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        });
      }

      const metaData = JSON.parse(meta);

      // Check upload progress for each file
      const files = [];
      for (let i = 0; i < (metaData.fileCount || 0); i++) {
        const uploadMeta = await env.KIASHARE_KV.get(`upload:${code}:${i}`);
        if (uploadMeta) {
          const u = JSON.parse(uploadMeta);
          files.push({
            index: i,
            name: u.fileName,
            mimeType: u.mimeType || 'application/octet-stream',
            totalChunks: u.totalChunks,
            uploadedChunks: u.chunks.length,
            complete: u.chunks.length >= u.totalChunks
          });
        }
      }

      return new Response(JSON.stringify({ 
        ...metaData, 
        files,
        ready: files.every(f => f.complete)
      }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // API: Download a file - FIXED VERSION
    if (path.startsWith('/api/download/') && request.method === 'GET') {
      const parts = path.split('/');
      const code = parts[3];
      const fileIndex = parts[4];

      // Get file metadata
      const uploadMeta = await env.KIASHARE_KV.get(`upload:${code}:${fileIndex}`);
      if (!uploadMeta) {
        return new Response('Not found', { status: 404, headers: corsHeaders });
      }

      const u = JSON.parse(uploadMeta);
      const fileName = u.fileName;
      const mimeType = u.mimeType || 'application/octet-stream';

      // Try to determine better MIME type from filename
      const ext = fileName.split('.').pop().toLowerCase();
      const mimeMap = {
        'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif',
        'webp': 'image/webp', 'svg': 'image/svg+xml',
        'mp4': 'video/mp4', 'webm': 'video/webm', 'mov': 'video/quicktime',
        'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'ogg': 'audio/ogg',
        'pdf': 'application/pdf',
        'doc': 'application/msword', 'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xls': 'application/vnd.ms-excel', 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'ppt': 'application/vnd.ms-powerpoint', 'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'txt': 'text/plain', 'csv': 'text/csv', 'json': 'application/json',
        'zip': 'application/zip', 'rar': 'application/x-rar-compressed',
        'js': 'application/javascript', 'css': 'text/css', 'html': 'text/html'
      };
      const finalMimeType = mimeMap[ext] || mimeType;

      // For images and videos, we can show inline, for others force download
      const isInline = finalMimeType.startsWith('image/') || finalMimeType.startsWith('video/') || finalMimeType.startsWith('audio/') || finalMimeType === 'application/pdf';

      // Build the response with proper headers
      // Collect all chunks first, then send as single response
      // This is more reliable than streaming for small files
      const chunks = [];
      let totalSize = 0;

      for (let i = 0; i < u.totalChunks; i++) {
        const chunkKey = `chunk:${code}:${fileIndex}:${i}`;
        const chunk = await env.KIASHARE_R2.get(chunkKey);
        if (chunk) {
          const arrayBuffer = await chunk.arrayBuffer();
          chunks.push(new Uint8Array(arrayBuffer));
          totalSize += arrayBuffer.byteLength;
        }
      }

      // Combine all chunks
      const combined = new Uint8Array(totalSize);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      // Use RFC 5987 for non-ASCII filenames
      const encodedName = encodeURIComponent(fileName).replace(/['()]/g, escape);

      return new Response(combined, {
        headers: {
          ...corsHeaders,
          'Content-Type': finalMimeType,
          'Content-Length': String(totalSize),
          'Content-Disposition': isInline 
            ? `inline; filename="${fileName}"; filename*=UTF-8''${encodedName}`
            : `attachment; filename="${fileName}"; filename*=UTF-8''${encodedName}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        }
      });
    }

    // Health check
    if (path === '/api/health') {
      return new Response(JSON.stringify({ status: 'ok', timestamp: Date.now() }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Serve static frontend (fallback)
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};

function generateCode() {
  // Generate 4-digit Persian-friendly code
  const digits = '0123456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += digits[Math.floor(Math.random() * 10)];
  }
  return code;
}
