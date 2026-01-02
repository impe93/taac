import { useDispatch, useSelector, useStore } from 'react-redux'
import type { RootState, AppDispatch, store } from './index'

// Typed hooks per Redux (raccomandato da RTK docs)
export const useAppDispatch = useDispatch.withTypes<AppDispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()
export const useAppStore = useStore.withTypes<typeof store>()
