export default {
  base: process.env.GH_PAGES ? '/gringojobs/' : '/',
  server: {
    proxy: {
      '/apify': {
        target: 'https://api.apify.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/apify/, '/v2'),
      }
    }
  }
}
