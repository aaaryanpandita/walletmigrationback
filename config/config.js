import _ from "lodash";
import config from "./config.json";

// const environment = 'development';  // for develeopment 
const environment = 'staging';  // for UAT
// const environment = 'production'; // for Production
const defaultConofig = config.development;  // default

const environmentConfig = config[environment];

const finalConfig = _.merge(defaultConofig, environmentConfig);
global.gConfig = finalConfig;