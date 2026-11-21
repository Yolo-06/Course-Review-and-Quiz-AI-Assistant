window.ASSISTANT_CONFIG = Object.assign({
  endpoint: '',
  autoEndpoint: true,
  model: 'codao-agent',
  timeout: 90000,
  stream: true,
  clientToken: ''
}, window.ASSISTANT_CONFIG || {});