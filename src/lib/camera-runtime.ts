// gphoto2 sees USB devices attached to the machine running the server. Hosted
// Vercel handlers cannot reach a camera plugged into the visitor's computer.
export function supportsServerUsbCamera() {
  return !process.env.VERCEL_ENV && !process.env.VERCEL_URL
}

export function cameraDesktopRequiredResponse() {
  return Response.json({
    error: 'Use Ciiya Sync on your computer to import photos from your camera.',
    code: 'CAMERA_DESKTOP_REQUIRED',
    connected: false,
    setupUrl: '/me/ciiya-sync',
  }, {
    status: 409,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}
