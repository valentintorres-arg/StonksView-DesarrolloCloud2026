// CloudFront Function (viewer-request, runtime cloudfront-js-2.0) asociada a la
// distribución del frontend. El export estático de Next genera cada ruta como
// <ruta>/index.html, pero un origen S3 solo resuelve index.html en la raíz
// (Default root object). Esta función reescribe las rutas sin archivo:
//   /login   -> /login/index.html
//   /login/  -> /login/index.html
// Los assets (/_next/..., /favicon.ico) tienen extensión y pasan sin cambios.
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri.endsWith("/")) {
    request.uri = uri + "index.html";
  } else if (!uri.split("/").pop().includes(".")) {
    request.uri = uri + "/index.html";
  }

  return request;
}
