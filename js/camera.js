// Camera access. A low frame rate is plenty for a preview and saves power.

export async function openCamera(facing) {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('No camera API'), { name: 'NotSupportedError' });
  }
  const video = {
    facingMode: { ideal: facing },
    width: { ideal: 1920 },
    height: { ideal: 1080 },
    frameRate: { ideal: 15, max: 30 },
  };
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: false, video });
  } catch (e) {
    if (e.name !== 'OverconstrainedError') throw e;
    return navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: facing } });
  }
}

export function closeCamera(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

export async function cameraCount() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput').length;
  } catch {
    return 1;
  }
}
