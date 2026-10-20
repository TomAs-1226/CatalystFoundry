const {macConfiguration}=require('./mac-configuration.cjs');
module.exports=macConfiguration(process.env.FOUNDRY_MAC_ARCH??'arm64',process.env.FOUNDRY_MAC_UNSIGNED==='1');
