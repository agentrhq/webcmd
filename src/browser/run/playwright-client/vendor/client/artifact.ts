// @ts-nocheck
/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { ChannelOwner } from './channelOwner';
import { Stream } from './stream';
import { mkdirIfNeeded } from './fileUtils';

import type * as channels from '@protocol/channels';
import type { Readable } from 'stream';

export class Artifact extends ChannelOwner<channels.ArtifactChannel> {
  static from(channel: channels.ArtifactChannel): Artifact {
    return (channel as any)._object;
  }

  async pathAfterFinished(): Promise<string> {
    throw new Error(`Path is not available in the QuickJS sandbox. Use saveAs() to save a logical artifact.`);
  }

  async saveAs(path: string): Promise<void> {
    await this._platform.fs().promises.writeFile(path, await this.readIntoBuffer());
  }

  async failure(): Promise<string | null> {
    return (await this._channel.failure()).error || null;
  }

  async createReadStream(): Promise<Readable> {
    throw new Error('Readable streams are not available in the QuickJS sandbox');
  }

  async readIntoBuffer(): Promise<Uint8Array> {
    const result = await this._channel.saveAsStream();
    const stream = Stream.from(result.stream);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { binary } = await stream._channel.read({ size: 64 * 1024 });
      if (!binary.byteLength) break;
      chunks.push(binary);
      size += binary.byteLength;
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  }

  async cancel(): Promise<void> {
    return await this._channel.cancel();
  }

  async delete(): Promise<void> {
    return await this._channel.delete();
  }
}
