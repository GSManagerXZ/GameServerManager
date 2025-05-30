import loader from '@monaco-editor/loader';
import * as monaco from 'monaco-editor';

// 配置@monaco-editor/react使用本地的monaco-editor包而不是CDN
loader.config({ monaco });

export default loader; 