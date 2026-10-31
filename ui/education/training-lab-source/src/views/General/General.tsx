import { IVariantContext, VariantContext } from '../../util/variant';
import _settings from './configuration.json';
import { useSearchParams, useParams } from 'react-router';
import { decompressFromEncodedURIComponent } from 'lz-string';
import Classifier from './Classifier';

export type VARIANTS = keyof typeof _settings;
export type VariantConfiguration = Record<VARIANTS, IVariantContext>;

const settings = _settings as VariantConfiguration;

export function Component() {
    const [params] = useSearchParams();
    const { kind, variant } = useParams();

    if (!variant || !(variant in _settings)) {
        return <div>Unknown variant {variant}</div>;
    }
    if (!kind || !(kind in _settings)) {
        return <div>Unknown model type {kind}</div>;
    }

    const customStr = decompressFromEncodedURIComponent(params.get('c') || '');
    const custom = (customStr ? JSON.parse(customStr) : {}) as IVariantContext;

    const merged = {
        ...settings.base,
        ...settings[kind as VARIANTS],
        ...settings[variant as VARIANTS],
        ...custom,
        // This vendored deployment runs locally without a signaling/API service.
        usep2p: false,
        enabledP2PData: false,
        enableCollaboration: false,
        allowModelSharing: false,
        allowDeploy: false,
        sampleDatasets: false,
        embedBehaviours: false,
        allowSerialUSB: false,
    };

    return (
        <VariantContext.Provider value={merged}>
            <Classifier />
        </VariantContext.Provider>
    );
}
