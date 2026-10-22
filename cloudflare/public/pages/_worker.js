const ORIGIN = "https://houdini-bet.ivanmarrtin2703.workers.dev";

export default {
  async fetch(request) {
    const target = new URL(request.url);
    const origin = new URL(ORIGIN);
    target.protocol = origin.protocol;
    target.host = origin.host;

    return fetch(new Request(target, request));
  },
};
