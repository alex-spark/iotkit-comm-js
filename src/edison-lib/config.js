module.exports =
{
  libRoot: __dirname,
  pluginInterfaceDir: "plugin-interfaces",
  pluginDir: "plugins",
  superInterfaceName: "interface-for-interfaces",
  pluginFileSuffixes: {
    clientFileSuffix: "client",
    serverFileSuffix: "service"
  },
  communication: {
    pluginFileSuffixes: {
      clientFileSuffix: "client",
      serverFileSuffix: "service"
    },
    plugins:
    [
      {pluginName: "zmqpubsub"},
      {pluginName: "mqtt"},
      {pluginName: "zmqreqrep"}
    ]
  }
};
