// const mobx = require('mobx');
// const mobxUtils = require('mobx-utils');
// Problems in current architecture:
// 1. After loading, can't tell what user actually set versus what came from e.g. GetCapabilities.
//  Solution: layering
// 2. CkanCatalogItem producing a WebMapServiceCatalogItem on load
// 3. Observable spaghetti
//  Solution: think in terms of pipelines with computed observables, document patterns.
// 4. All code for all catalog item types needs to be loaded before we can do anything.
import { autorun, computed, observable, runInAction, trace } from 'mobx';
import { createTransformer } from 'mobx-utils';
import Rectangle from 'terriajs-cesium/Source/Core/Rectangle';
import WebMercatorTilingScheme from 'terriajs-cesium/Source/Core/WebMercatorTilingScheme';
import WebMapServiceImageryProvider from 'terriajs-cesium/Source/Scene/WebMapServiceImageryProvider';
import URI from 'urijs';
import containsAny from '../Core/containsAny';
import isReadOnlyArray from '../Core/isReadOnlyArray';
import TerriaError from '../Core/TerriaError';
import CatalogMemberMixin from '../ModelMixins/CatalogMemberMixin';
import GetCapabilitiesMixin from '../ModelMixins/GetCapabilitiesMixin';
import GroupMixin from '../ModelMixins/GroupMixin';
import UrlMixin from '../ModelMixins/UrlMixin';
import { InfoSectionTraits } from '../Traits/CatalogMemberTraits';
import WebMapServiceCatalogItemTraits, { LegendTraits, WebMapServiceAvailableLayerStylesTraits } from '../Traits/WebMapServiceCatalogItemTraits';
import createStratumInstance from './createStratumInstance';
import LoadableStratum from './LoadableStratum';
import Mappable, { ImageryParts } from './Mappable';
import CreateModel from './CreateModel';
import proxyCatalogItemUrl from './proxyCatalogItemUrl';
import StratumFromTraits from './StratumFromTraits';
import Terria from './Terria';
import WebMapServiceCapabilities, { CapabilitiesLayer, CapabilitiesStyle, getRectangleFromLayer } from './WebMapServiceCapabilities';
import { RectangleTraits } from '../Traits/MappableTraits';
import { DiscreteTimeTraits } from '../Traits/DiscretelyTimeVaryingTraits';

interface LegendUrl {
    url: string;
    mimeType?: string;
}

interface WebMapServiceStyle {
    name: string;
    title: string;
    abstract?: string;
    legendUrl?: LegendUrl;
}

interface WebMapServiceStyles {
    [layerName: string]: WebMapServiceStyle[];
}

class GetCapabilitiesStratum extends LoadableStratum(WebMapServiceCatalogItemTraits) {
    static load(catalogItem: WebMapServiceCatalogItem): Promise<GetCapabilitiesStratum> {
        console.log('Loading GetCapabilities');

        if (catalogItem.getCapabilitiesUrl === undefined) {
            return Promise.reject(new TerriaError({
                title: 'Unable to load GetCapabilities',
                message: 'Could not load the Web Map Service (WMS) GetCapabilities document because the catalog item does not have a `url`.'
            }));
        }

        const proxiedUrl = proxyCatalogItemUrl(catalogItem, catalogItem.getCapabilitiesUrl, catalogItem.getCapabilitiesCacheDuration);
        return WebMapServiceCapabilities.fromUrl(proxiedUrl).then(capabilities => {
            return new GetCapabilitiesStratum(catalogItem, capabilities);
        });
    }

    constructor(readonly catalogItem: WebMapServiceCatalogItem, readonly capabilities: WebMapServiceCapabilities) {
        super();
    }

    @computed
    get capabilitiesLayers(): ReadonlyMap<string, CapabilitiesLayer | undefined> {
        const lookup: (name: string) => [string, CapabilitiesLayer | undefined] = name => [name, this.capabilities && this.capabilities.findLayer(name)];
        return new Map(this.catalogItem.layersArray.map(lookup));
    }

    @computed
    get availableStyles(): StratumFromTraits<WebMapServiceAvailableLayerStylesTraits>[] {
        const result: StratumFromTraits<WebMapServiceAvailableLayerStylesTraits>[] = [];

        if (!this.capabilities) {
            return result;
        }

        const capabilitiesLayers = this.capabilitiesLayers;

        for (const layerTuple of capabilitiesLayers) {
            const layerName = layerTuple[0];
            const layer = layerTuple[1];

            const styles: ReadonlyArray<CapabilitiesStyle> = layer ? this.capabilities.getInheritedValues(layer, 'Style') : [];
            result.push({
                layerName: layerName,
                styles: styles.map(style => {
                    var wmsLegendUrl = isReadOnlyArray(style.LegendURL) ? style.LegendURL[0] : style.LegendURL;

                    var legendUri, legendMimeType;
                    if (wmsLegendUrl && wmsLegendUrl.OnlineResource && wmsLegendUrl.OnlineResource['xlink:href']) {
                        legendUri = new URI(decodeURIComponent(wmsLegendUrl.OnlineResource['xlink:href']));
                        legendMimeType = wmsLegendUrl.Format;
                    }

                    const legendUrl = !legendUri ? undefined : {
                        url: legendUri.toString(),
                        mimeType: legendMimeType
                    };

                    return {
                        name: style.Name,
                        title: style.Title,
                        abstract: style.Abstract,
                        legendUrl: legendUrl
                    };
                })
            });
        }

        return result;
    }

    @computed
    get info(): StratumFromTraits<InfoSectionTraits>[] {
        const result: StratumFromTraits<InfoSectionTraits>[] = [];

        let firstDataDescription: string | undefined;
        for (const layer of this.capabilitiesLayers.values()) {
            if (!layer || !layer.Abstract || containsAny(layer.Abstract, WebMapServiceCatalogItem.abstractsToIgnore)) {
                continue;
            }

            const suffix = this.capabilitiesLayers.size === 1 ? '' : ` - ${layer.Title}`;
            const name = `Data Description${suffix}`;

            const traits = createStratumInstance(InfoSectionTraits);
            traits.name = name;
            traits.content = layer.Abstract;
            result.push(traits);

            firstDataDescription = firstDataDescription || layer.Abstract;
        }

        // Show the service abstract if there is one and if it isn't the Geoserver default "A compliant implementation..."
        const service = this.capabilities && this.capabilities.Service;
        if (service) {
            if (service && service.Abstract && !containsAny(service.Abstract, WebMapServiceCatalogItem.abstractsToIgnore) && service.Abstract !== firstDataDescription) {
                const traits = createStratumInstance(InfoSectionTraits);
                traits.name = 'Service Description';
                traits.content = service.Abstract;
                result.push(traits);
            }

            // Show the Access Constraints if it isn't "none" (because that's the default, and usually a lie).
            if (service.AccessConstraints && !/^none$/i.test(service.AccessConstraints)) {
                const traits = createStratumInstance(InfoSectionTraits);
                traits.name = 'Access Constraints';
                traits.content = service.AccessConstraints;
                result.push(traits);
            }
        }

        return result;
    }

    @computed
    get rectangle(): StratumFromTraits<RectangleTraits> | undefined {
        const layers: CapabilitiesLayer[] = [...this.capabilitiesLayers.values()].filter(layer => layer !== undefined).map(l => l!);
        // Needs to take union of all layer rectangles
        return layers.length > 0 ? getRectangleFromLayer(layers[0]) : undefined
        // if (layers.length === 1) {
        //     return getRectangleFromLayer(layers[0]);
        // }
        // Otherwise get the union of rectangles from all layers
        // return undefined;
    }

    @computed
    get isGeoServer(): boolean | undefined {
        if (!this.capabilities) {
            return undefined;
        }

        if (!this.capabilities.Service ||
            !this.capabilities.Service.KeywordList ||
            !this.capabilities.Service.KeywordList.Keyword)
        {
            return false;
        }

        const keyword = this.capabilities.Service.KeywordList.Keyword;
        if (isReadOnlyArray(keyword)) {
            return keyword.indexOf('GEOSERVER') >= 0;
        } else {
            return keyword === 'GEOSERVER';
        }
    }

    @computed
    get legendUrls(): StratumFromTraits<LegendTraits>[] {
        const result: StratumFromTraits<LegendTraits>[] = [];

        // TODO

        // const availableStyles = this.availableStyles || [];
        // this.capabilitiesLayers.forEach((layer, name) => {
        //     const styles = availableStyles.find(candidate => candidate.layerName === name);
        //     if (styles === undefined || styles.styles === undefined) {
        //         return [];
        //     }
        //     const legendUrls = styles.styles.map(style => style.legendUrl).filter(legendUrl => legendUrl !== undefined).map(l => l!);
        //     return legendUrls;
        // });

        return result;
    }

    @computed
    get discreteTimes(): StratumFromTraits<DiscreteTimeTraits>[] | undefined {
        const result: StratumFromTraits<DiscreteTimeTraits>[] = [];

        for (let layer of this.capabilitiesLayers.values()) {
            if (!layer) {
                continue;
            }
            const dimensions = this.capabilities.getInheritedValues(layer, 'Dimension');
            const timeDimension = dimensions.find(dimension => dimension.name.toLowerCase() === 'time');
            if (!timeDimension) {
                continue;
            }

            let extent: string = timeDimension;

            // WMS 1.1.1 puts dimension values in an Extent element instead of directly in the Dimension element.
            const extentElements = this.capabilities.getInheritedValues(layer, 'Extent');
            const extentElement = extentElements.find(extent => extent.name.toLowerCase() === 'time');
            if (extentElement) {
                extent = extentElement;
            }

            if (!extent || !extent.split) {
                continue;
            }

            const values = extent.split(',');
            for (let i = 0; i < values.length; ++i) {
                result.push({
                    time: values[i],
                    tag: undefined
                });
            }

            // TODO: remove duplicates? sort the times?
        }

        return result;
    }
}

class WebMapServiceCatalogItem extends GetCapabilitiesMixin(UrlMixin(CatalogMemberMixin(CreateModel(WebMapServiceCatalogItemTraits)))) implements Mappable {
    /**
     * The collection of strings that indicate an Abstract property should be ignored.  If these strings occur anywhere
     * in the Abstract, the Abstract will not be used.  This makes it easy to filter out placeholder data like
     * Geoserver's "A compliant implementation of WMS..." stock abstract.
     */
    static abstractsToIgnore = [
        'A compliant implementation of WMS'
    ];

    static defaultParameters = {
        transparent:  true,
        format: 'image/png',
        exceptions: 'application/vnd.ogc.se_xml',
        styles: '',
        tiled: true
    };

    static readonly type = 'wms';
    readonly canZoomTo = true;
    readonly showsInfo = true;

    @observable
    ancestors: (GroupMixin.GroupMixin & CatalogMemberMixin.CatalogMemberMixin)[] | undefined;

    get type() {
        return WebMapServiceCatalogItem.type;
    }

    // TODO
    get isMappable() {
        return true;
    }

    constructor(id: string, terria: Terria) {
        super(id, terria);
        if (this.opacity === undefined) {
            console.log('Whaaaaa... This should have a default of 0.8');
        }
        autorun(() => {
            console.log(`Opacity changed to ${this.opacity}`);
        })
    }

    protected get loadMetadataPromise(): Promise<void> {
        return GetCapabilitiesStratum.load(this).then(stratum => {
            runInAction(() => {
                this.strata.set(GetCapabilitiesMixin.getCapabilitiesStratumName, stratum);
            });
        });
    }

    loadMapItems(): Promise<void> {
        return this.loadMetadata();
    }

    @computed
    get layersArray(): ReadonlyArray<string> {
        if (Array.isArray(this.layers)) {
            return this.layers;
        } else if (this.layers) {
            return this.layers.split(',');
        } else {
            return [];
        }
    }

    protected get defaultGetCapabilitiesUrl(): string | undefined {
        if (this.uri) {
            return this.uri.clone().setSearch({
                service: 'WMS',
                version: '1.3.0',
                request: 'GetCapabilities'
            }).toString();
        } else {
            return undefined;
        }
    }

    @computed
    get currentDiscreteTime(): string | undefined {
        return undefined; // TODO
    }

    @computed
    get nextDiscreteTime(): string | undefined {
        return undefined; // TODO
    }

    @computed
    get mapItems() {
        trace();
        const result = [];

        const current = this._currentImageryParts;
        if (current) {
            result.push(current);
        }

        const next = this._nextImageryParts;
        if (next) {
            result.push(next);
        }

        return result;
    }

    isPreviousTimeAvailable(): boolean {
        return false;
    }

    isNextTimeAvailable(): boolean {
        return false;
    }

    @computed
    private get _currentImageryParts(): ImageryParts | undefined {
        trace();
        const imageryProvider = this._createImageryProvider(this.currentDiscreteTime || 'now');
        if (imageryProvider === undefined) {
            return undefined;
        }
        return {
            imageryProvider,
            alpha: this.opacity,
            show: this.show !== undefined ? this.show : true
        }
    }

    @computed
    private get _nextImageryParts(): ImageryParts | undefined {
        trace();
        if (this.nextDiscreteTime) {
            const imageryProvider = this._createImageryProvider(this.nextDiscreteTime);
            if (imageryProvider === undefined) {
                return undefined;
            }
            return {
                imageryProvider,
                alpha: 0.0,
                show: true
            };
        } else {
            return undefined;
        }
    }

    private _createImageryProvider = createTransformer((time: string): Cesium.WebMapServiceImageryProvider | undefined => {
        // Don't show anything on the map until GetCapabilities finishes loading.
        if (this.isLoadingMetadata) {
            return undefined;
        }

        console.log(`Creating new ImageryProvider for ${time}`);

        return new WebMapServiceImageryProvider({
            url: this.url || '',
            // layers: this.layers || '',
            // For testing prefetching
            layers: time !== 'now' ? time : (this.layers || ''),
            // getFeatureInfoFormats: this.getFeatureInfoFormats,
            // parameters: parameters,
            parameters: WebMapServiceCatalogItem.defaultParameters,
            // getFeatureInfoParameters: parameters,
            tilingScheme: /*defined(this.tilingScheme) ? this.tilingScheme :*/ new WebMercatorTilingScheme(),
            maximumLevel: 20,
            rectangle: this.rectangle ? Rectangle.fromDegrees(this.rectangle.west, this.rectangle.south, this.rectangle.east, this.rectangle.north) : undefined
        });
    })

}

export default WebMapServiceCatalogItem;
