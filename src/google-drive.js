const scope = 'https://www.googleapis.com/auth/drive.file';
const api = 'https://www.googleapis.com/drive/v3';
const uploadApi = 'https://www.googleapis.com/upload/drive/v3';

export function loadGoogleIdentity() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Google sign-in. Check your connection.'));
    document.head.append(script);
  });
}

export function authorizeDrive(clientId) {
  return new Promise((resolve, reject) => {
    if (!globalThis.google?.accounts?.oauth2) {
      reject(new Error('Google sign-in is not ready.'));
      return;
    }
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope,
      callback(response) {
        if (response.error) {
          reject(new Error(response.error_description || response.error));
        } else if (!response.access_token || !google.accounts.oauth2.hasGrantedAllScopes(response, scope)) {
          reject(new Error('Google Drive access was not granted.'));
        } else {
          resolve({ token: response.access_token, expiresAt: Date.now() + Number(response.expires_in) * 1000 });
        }
      },
      error_callback(error) {
        reject(new Error(`Google sign-in failed: ${error.type || 'unknown error'}`));
      },
    });
    client.requestAccessToken();
  });
}

export class GoogleDrive {
  constructor(token) {
    this.token = token;
  }

  async request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { ...options.headers, Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) {
      const detail = await response.text();
      const error = new Error(`Google Drive request failed (${response.status}): ${detail.slice(0, 500)}`);
      error.status = response.status;
      throw error;
    }
    return response;
  }

  async list(query) {
    const files = [];
    let pageToken;
    do {
      const params = new URLSearchParams({
        q: query, fields: 'nextPageToken,files(id,name,mimeType,createdTime,appProperties)', pageSize: '100',
      });
      if (pageToken) params.set('pageToken', pageToken);
      const page = await (await this.request(`${api}/files?${params}`)).json();
      files.push(...page.files);
      pageToken = page.nextPageToken;
    } while (pageToken);
    return files;
  }

  async folder() {
    const folders = await this.list("name = 'refaceCS' and mimeType = 'application/vnd.google-apps.folder' and trashed = false");
    if (folders.length > 1) throw new Error('More than one refaceCS Drive folder is accessible; leave only one.');
    if (folders.length) return folders[0].id;
    const response = await this.request(`${api}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'refaceCS', mimeType: 'application/vnd.google-apps.folder' }),
    });
    return (await response.json()).id;
  }

  async createFile(folder, name, data, mimeType, appProperties = {}) {
    const metadata = { name, parents: [folder], mimeType, appProperties };
    const initial = await this.request(`${uploadApi}/files?uploadType=resumable&fields=id,name,createdTime,appProperties`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(data.size),
      },
      body: JSON.stringify(metadata),
    });
    const location = initial.headers.get('Location');
    if (!location) throw new Error('Google Drive did not return an upload URL.');
    if (new URL(location).origin !== 'https://www.googleapis.com') throw new Error('Google Drive returned an invalid upload URL.');
    const response = await this.request(location, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: data });
    return response.json();
  }

  async download(id) {
    return (await this.request(`${api}/files/${encodeURIComponent(id)}?alt=media`)).blob();
  }
}
