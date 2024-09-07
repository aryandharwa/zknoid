import { PublicKey, UInt64 } from 'o1js';
import { useContext, useEffect } from 'react';
import { useProtokitChainStore } from '@/lib/stores/protokitChain';
import { useNetworkStore } from '@/lib/stores/network';
import ZkNoidGameContext from '@/lib/contexts/ZkNoidGameContext';
import { battleshipsConfig } from '../config';
import { type ClientAppChain } from '@proto-kit/sdk';
import {
  MatchQueueState,
  matchQueueInitializer,
} from '@/lib/stores/matchQueue';
import { create } from 'zustand';

export const useBattleshipsMatchQueueStore = create<
  MatchQueueState,
  [['zustand/immer', never]]
>(matchQueueInitializer);

