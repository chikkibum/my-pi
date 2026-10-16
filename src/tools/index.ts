import type { Tool } from '../types.ts';
import { bashTool } from './bash.ts';
import { editTool } from './edit.ts';
import { readTool } from './read.ts';
import { writeTool } from './write.ts';

// Every tool the agent can call. To add one, create a file exporting a Tool and list it here.
export const tools: Tool[] = [readTool, writeTool, editTool, bashTool];
