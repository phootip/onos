/*
 * Copyright 2019-present Open Networking Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import {
    Component,
    OnDestroy,
    OnInit, SimpleChange,
    ViewChild
} from '@angular/core';
import * as d3 from 'd3';
import {
    FnService, IconService,
    KeysService,
    KeysToken, LionService,
    LogService,
    PrefsService,
    SvgUtilService,
    WebSocketService,
    ZoomService
} from 'gui2-fw-lib';
import {InstanceComponent} from '../panel/instance/instance.component';
import {DetailsComponent} from '../panel/details/details.component';
import {BackgroundSvgComponent} from '../layer/backgroundsvg/backgroundsvg.component';
import {ForceSvgComponent} from '../layer/forcesvg/forcesvg.component';
import {TopologyService} from '../topology.service';
import {
    HostLabelToggle,
    LabelToggle,
    UiElement
} from '../layer/forcesvg/models';
import {
    INSTANCE_TOGGLE, SUMMARY_TOGGLE, DETAILS_TOGGLE,
    HOSTS_TOGGLE, OFFLINE_TOGGLE, PORTS_TOGGLE,
    BKGRND_TOGGLE, CYCLELABELS_BTN, CYCLEHOSTLABEL_BTN,
    RESETZOOM_BTN, EQMASTER_BTN,
    CANCEL_TRAFFIC, ALL_TRAFFIC, QUICKHELP_BTN
} from '../panel/toolbar/toolbar.component';
import {TrafficService} from '../traffic.service';
import {ZoomableDirective} from '../layer/zoomable.directive';

const TOPO2_PREFS = 'topo2_prefs';
const PREF_BG = 'bg';
const PREF_DETAIL = 'detail';
const PREF_DLBLS = 'dlbls';
const PREF_HLBLS = 'hlbls';
const PREF_HOSTS = 'hosts';
const PREF_INSTS = 'insts';
const PREF_OFFDEV = 'offdev';
const PREF_PORTHL = 'porthl';
const PREF_SUMMARY = 'summary';
const PREF_TOOLBAR = 'toolbar';

/**
 * model of the topo2_prefs object - this is a subset of the overall Prefs returned
 * by the server
 */
export interface Topo2Prefs {
    bg: number;
    detail: number;
    dlbls: number;
    hlbls: number;
    hosts: number;
    insts: number;
    offdev: number;
    porthl: number;
    spr: number;
    ovid: string;
    summary: number;
    toolbar: number;
}

/**
 * ONOS GUI Topology View
 *
 * This Topology View component is the top level component in a hierarchy that
 * comprises the whole Topology View
 *
 * There are three main parts (panels, graphical and breadcrumbs)
 * The panel hierarchy
 * |-- Instances Panel (shows ONOS instances)
 * |-- Summary Panel (summary of ONOS)
 * |-- Toolbar Panel (the toolbar)
 * |-- Details Panel (when a node is selected in the Force graphical view (see below))
 *
 * The graphical hierarchy contains
 * Topology (this)
 *  |-- No Devices Connected (only of there are no nodes to show)
 *  |-- Zoom Layer (everything beneath this can be zoomed and panned)
 *      |-- Background (container for any backgrounds - can be toggled on and off)
 *          |-- Map
 *      |-- Forces (all of the nodes and links laid out by a d3.force simulation)
 *
 * The breadcrumbs
 * |-- Breadcrumb (in region view a way of navigating back up through regions)
 */
@Component({
  selector: 'onos-topology',
  templateUrl: './topology.component.html',
  styleUrls: ['./topology.component.css']
})
export class TopologyComponent implements OnInit, OnDestroy {
    // These are references to the components inserted in the template
    @ViewChild(InstanceComponent) instance: InstanceComponent;
    @ViewChild(DetailsComponent) details: DetailsComponent;
    @ViewChild(BackgroundSvgComponent) background: BackgroundSvgComponent;
    @ViewChild(ForceSvgComponent) force: ForceSvgComponent;
    @ViewChild(ZoomableDirective) zoomDirective: ZoomableDirective;

    flashMsg: string = '';
    // These are used as defaults if nothing is set on the server
    prefsState: Topo2Prefs = <Topo2Prefs>{
        bg: 0,
        detail: 1,
        dlbls: 0,
        hlbls: 2,
        hosts: 0,
        insts: 1,
        offdev: 1,
        ovid: 'traffic', // default to traffic overlay
        porthl: 1,
        spr: 0,
        summary: 1,
        toolbar: 0,
    };
    lionFn; // Function

    constructor(
        protected log: LogService,
        protected fs: FnService,
        protected ks: KeysService,
        protected sus: SvgUtilService,
        protected ps: PrefsService,
        protected wss: WebSocketService,
        protected ts: TopologyService,
        protected trs: TrafficService,
        protected is: IconService,
        private lion: LionService,
    ) {
        if (this.lion.ubercache.length === 0) {
            this.lionFn = this.dummyLion;
            this.lion.loadCbs.set('topo-toolbar', () => this.doLion());
        } else {
            this.doLion();
        }

        this.is.loadIconDef('bird');
        this.is.loadIconDef('active');
        this.is.loadIconDef('uiAttached');
        this.is.loadIconDef('m_switch');
        this.is.loadIconDef('m_roadm');
        this.is.loadIconDef('m_router');
        this.is.loadIconDef('m_uiAttached');
        this.is.loadIconDef('m_endstation');
        this.is.loadIconDef('m_ports');
        this.is.loadIconDef('m_summary');
        this.is.loadIconDef('m_details');
        this.is.loadIconDef('m_map');
        this.is.loadIconDef('m_cycleLabels');
        this.is.loadIconDef('m_resetZoom');
        this.is.loadIconDef('m_eqMaster');
        this.is.loadIconDef('m_unknown');
        this.is.loadIconDef('m_allTraffic');
        this.is.loadIconDef('deviceTable');
        this.is.loadIconDef('flowTable');
        this.is.loadIconDef('portTable');
        this.is.loadIconDef('groupTable');
        this.is.loadIconDef('meterTable');
        this.is.loadIconDef('triangleUp');
        this.log.debug('Topology component constructed');
    }

    /**
     * Static functions must come before member variables
     * @param index
     */
    private static deviceLabelFlashMessage(index: number): string {
        switch (index) {
            case 0: return 'fl_device_labels_hide';
            case 1: return 'fl_device_labels_show_friendly';
            case 2: return 'fl_device_labels_show_id';
        }
    }

    private static hostLabelFlashMessage(index: number): string {
        switch (index) {
            case 0: return 'fl_host_labels_hide';
            case 1: return 'fl_host_labels_show_friendly';
            case 2: return 'fl_host_labels_show_ip';
            case 3: return 'fl_host_labels_show_mac';
        }
    }

    /**
     * Pass the list of Key Commands to the KeyService, and initialize the Topology
     * Service - which communicates with through the WebSocket to the ONOS server
     * to get the nodes and links.
     */
    ngOnInit() {
        this.bindCommands();
        // The components from the template are handed over to TopologyService here
        // so that WebSocket responses can be passed back in to them
        // The handling of the WebSocket call is delegated out to the Topology
        // Service just to compartmentalize things a bit
        this.ts.init(this.instance, this.background, this.force);

        this.ps.addListener((data) => this.prefsUpdateHandler(data));
        this.prefsState = this.ps.getPrefs(TOPO2_PREFS, this.prefsState);
        this.log.debug('Topology component initialized');
    }

    /**
     * Callback function that's called whenever new Prefs are received from WebSocket
     *
     * Note: At present the backend server does not filter updated by logged in user,
     * so you might get updates pertaining to a different user
     */
    prefsUpdateHandler(data: any): void {
        // Extract the TOPO2 prefs from it
        this.prefsState = data[TOPO2_PREFS];
        this.log.debug('Updated topo2 prefs', this.prefsState);
    }

    /**
     * When this component is being stopped, disconnect the TopologyService from
     * the WebSocket
     */
    ngOnDestroy() {
        this.ts.destroy();
        this.ps.removeListener((data) => this.prefsUpdateHandler(data));
        this.log.debug('Topology component destroyed');
    }

    /**
     * When ever a toolbar button is clicked, an event is sent up from toolbar
     * component which is caught and passed on to here.
     * @param name The name of the button that was clicked
     */
    toolbarButtonClicked(name: string) {
        switch (name) {
            case INSTANCE_TOGGLE:
                this.toggleInstancePanel();
                break;
            case SUMMARY_TOGGLE:
                this.toggleSummary();
                break;
            case DETAILS_TOGGLE:
                this.toggleDetails();
                break;
            case HOSTS_TOGGLE:
                this.toggleHosts();
                break;
            case OFFLINE_TOGGLE:
                this.toggleOfflineDevices();
                break;
            case PORTS_TOGGLE:
                this.togglePorts();
                break;
            case BKGRND_TOGGLE:
                this.toggleBackground();
                break;
            case CYCLELABELS_BTN:
                this.cycleDeviceLabels();
                break;
            case CYCLEHOSTLABEL_BTN:
                this.cycleHostLabels();
                break;
            case RESETZOOM_BTN:
                this.resetZoom();
                break;
            case EQMASTER_BTN:
                this.equalizeMasters();
                break;
            case CANCEL_TRAFFIC:
                this.cancelTraffic();
                break;
            case ALL_TRAFFIC:
                this.monitorAllTraffic();
                break;
            case QUICKHELP_BTN:
                this.ks.quickHelpShown = true;
                break;
            default:
                this.log.warn('Unhandled Toolbar action', name);
        }
    }

    /**
     * The list of key strokes that will be active in the Topology View.
     *
     * This action map is passed to the KeyService through the bindCommands()
     * when this component is being initialized
     */
    actionMap() {
        return {
            A: [() => {this.monitorAllTraffic(); }, 'Monitor all traffic'],
            L: [() => {this.cycleDeviceLabels(); }, 'Cycle device labels'],
            B: [(token) => {this.toggleBackground(token); }, 'Toggle background'],
            D: [(token) => {this.toggleDetails(token); }, 'Toggle details panel'],
            I: [(token) => {this.toggleInstancePanel(token); }, 'Toggle ONOS Instance Panel'],
            O: [() => {this.toggleSummary(); }, 'Toggle the Summary Panel'],
            R: [() => {this.resetZoom(); }, 'Reset pan / zoom'],
            P: [(token) => {this.togglePorts(token); }, 'Toggle Port Highlighting'],
            E: [() => {this.equalizeMasters(); }, 'Equalize mastership roles'],
            X: [() => {this.resetNodeLocation(); }, 'Reset Node Location'],
            U: [() => {this.unpinNode(); }, 'Unpin node (mouse over)'],
            H: [() => {this.toggleHosts(); }, 'Toggle host visibility'],
            M: [() => {this.toggleOfflineDevices(); }, 'Toggle offline visibility'],
            dot: [() => {this.toggleToolbar(); }, 'Toggle Toolbar'],
            0: [() => {this.cancelTraffic(); }, 'Cancel traffic monitoring'],
            'shift-L': [() => {this.cycleHostLabels(); }, 'Cycle host labels'],

            // -- instance color palette debug
            9: () => {
                this.sus.cat7().testCard(d3.select('svg#topo2'));
            },

            esc: [() => {this.handleEscape(); }, 'Cancel commands'],

            // TODO update after adding in Background Service
            // topology overlay selections
            // F1: function () { t2tbs.fnKey(0); },
            // F2: function () { t2tbs.fnKey(1); },
            // F3: function () { t2tbs.fnKey(2); },
            // F4: function () { t2tbs.fnKey(3); },
            // F5: function () { t2tbs.fnKey(4); },
            //
            // _keyListener: t2tbs.keyListener.bind(t2tbs),

            _helpFormat: [
                ['I', 'O', 'D', 'H', 'M', 'P', 'dash', 'B'],
                ['X', 'Z', 'N', 'L', 'shift-L', 'U', 'R', 'E', 'dot'],
                [], // this column reserved for overlay actions
            ],
        };
    }


    bindCommands(additional?: any) {

        const am = this.actionMap();
        const add = this.fs.isO(additional);

        this.ks.keyBindings(am);

        this.ks.gestureNotes([
            ['click', 'Select the item and show details'],
            ['shift-click', 'Toggle selection state'],
            ['drag', 'Reposition (and pin) device / host'],
            ['cmd-scroll', 'Zoom in / out'],
            ['cmd-drag', 'Pan'],
        ]);
    }

    handleEscape() {

        if (false) {
            // TODO: Cancel show mastership
            // TODO: Cancel Active overlay
            // TODO: Reinstate with components
        } else {
            this.nodeSelected(undefined);
            this.log.debug('Handling escape');
            // } else if (t2rs.deselectAllNodes()) {
            //     // else if we have node selections, deselect them all
            //     // (work already done)
            // } else if (t2rs.deselectLink()) {
            //     // else if we have a link selection, deselect it
            //     // (work already done)
            // } else if (t2is.isVisible()) {
            //     // If the instance panel is visible, close it
            //     t2is.toggle();
            // } else if (t2sp.isVisible()) {
            //     // If the summary panel is visible, close it
            //     t2sp.toggle();
        }
    }

    /**
     * Updates the cache of preferences locally and onwards to the PrefsService
     * @param what The attribute of the local topo2-prefs cache to update
     * @param b the value to update it with
     */
    updatePrefsState(what: string, b: number) {
        this.prefsState[what] = b;
        this.ps.setPrefs(TOPO2_PREFS, this.prefsState);
    }

    /**
     * When the button is clicked on the toolbar or the L key is pressed
     * 1) cycle through options
     * 2) flash up a message
     * 3a) Update the local prefs cache
     * 3b) And passes on to the global prefs service which sends back to the server
     * 3c) It also has a knock on effect of passing it on to ForceSvgComponent
     *      because prefsState.dlbls is given as an input to it
     * 3d) This will in turn pass it down to the DeviceSvgComponent which
     *       displays the label
     */
    protected cycleDeviceLabels() {
        const old: LabelToggle = this.prefsState.dlbls;
        const next = LabelToggle.next(old);
        this.flashMsg = this.lionFn(TopologyComponent.deviceLabelFlashMessage(next));
        this.updatePrefsState(PREF_DLBLS, next);
        this.log.debug('Cycling device labels', old, next);
    }

    protected cycleHostLabels() {
        const old: HostLabelToggle = this.prefsState.hlbls;
        const next = HostLabelToggle.next(old);
        this.flashMsg = this.lionFn(TopologyComponent.hostLabelFlashMessage(next));
        this.updatePrefsState(PREF_HLBLS, next);
        this.log.debug('Cycling host labels', old, next);
    }

    /**
     * When the button is clicked on the toolbar or the B key is pressed
     * 1) Find the inverse of the current state (held as 1 or 0)
     * 2) Flash up a message on screen
     * 3b) And passes on to the global prefs service which sends back to the server
     * 3c) It also has a knock on effect of passing it on to ToolbarComponent
     *      because prefsState.bg is given as an input to it
     * @param token
     */
    protected toggleBackground(token?: KeysToken) {
        const bg: boolean = !Boolean(this.prefsState.bg);
        this.flashMsg = this.lionFn(bg ? 'show' : 'hide') +
            ' ' + this.lionFn('fl_background_map');
        this.updatePrefsState(PREF_BG, bg ? 1 : 0);
        this.log.debug('Toggling background', token, bg ? 'shown' : 'hidden');
    }

    protected toggleDetails(token?: KeysToken) {
        const on: boolean = !Boolean(this.prefsState.detail);
        this.flashMsg = this.lionFn(on ? 'show' : 'hide') +
            ' ' + this.lionFn('fl_panel_details');
        this.updatePrefsState(PREF_DETAIL, on ? 1 : 0);
        this.log.debug('Toggling details', token);
    }

    protected toggleInstancePanel(token?: KeysToken) {
        const on: boolean = !Boolean(this.prefsState.insts);
        this.flashMsg = this.lionFn(on ? 'show' : 'hide') +
            ' ' + this.lionFn('fl_panel_instances');
        this.updatePrefsState(PREF_INSTS, on ? 1 : 0);
        this.log.debug('Toggling instances', token, on);
    }

    protected toggleSummary() {
        const on: boolean = !Boolean(this.prefsState.summary);
        this.flashMsg = this.lionFn(on ? 'show' : 'hide') +
            ' ' + this.lionFn('fl_panel_summary');
        this.updatePrefsState(PREF_SUMMARY, on ? 1 : 0);
    }

    protected togglePorts(token?: KeysToken) {
        const current: boolean = !Boolean(this.prefsState.porthl);
        this.flashMsg = this.lionFn(current ? 'enable' : 'disable') +
            ' ' + this.lionFn('fl_port_highlighting');
        this.updatePrefsState(PREF_PORTHL, current ? 1 : 0);
        this.log.debug(current ? 'Enable' : 'Disable', 'port highlighting');
    }

    protected toggleToolbar() {
        const on: boolean = !Boolean(this.prefsState.toolbar);
        this.updatePrefsState(PREF_TOOLBAR, on ? 1 : 0);
        this.log.debug('toggling toolbar', on ? 'shown' : 'hidden');
    }

    protected toggleHosts() {
        const current: boolean = !Boolean(this.prefsState.hosts);
        this.flashMsg = this.lionFn('hosts') + ' ' +
                        this.lionFn(this.force.showHosts ? 'visible' : 'hidden');
        this.updatePrefsState(PREF_HOSTS, current ? 1 : 0);
        this.log.debug('toggling hosts: ', this.prefsState.hosts ? 'Show' : 'Hide');
    }

    protected toggleOfflineDevices() {
        const on: boolean = !Boolean(this.prefsState.offdev);
        this.flashMsg = this.lionFn(on ? 'show' : 'hide') +
            ' ' + this.lionFn('fl_offline_devices');
        this.updatePrefsState(PREF_OFFDEV, on ? 1 : 0);
        this.log.debug('toggling offline devices', this.prefsState.offdev);
    }

    protected resetZoom() {
        this.zoomDirective.resetZoom();
        this.flashMsg = this.lionFn('fl_pan_zoom_reset');
    }

    protected equalizeMasters() {
        this.wss.sendEvent('equalizeMasters', null);
        this.flashMsg = this.lionFn('fl_eq_masters');
        this.log.debug('equalizing masters');
    }

    protected resetNodeLocation() {
        // TODO: Implement reset locations
        this.flashMsg = this.lionFn('fl_reset_node_locations');
        this.log.debug('resetting node location');
    }

    protected unpinNode() {
        // TODO: Implement this
        this.log.debug('unpinning node');
    }

    /**
     * Check to see if this is needed anymore
     * @param what
     */
    protected notValid(what) {
        this.log.warn('topo.js getActionEntry(): Not a valid ' + what);
    }

    /**
     * Check to see if this is needed anymore
     * @param what
     */
    getActionEntry(key) {
        let entry;

        if (!key) {
            this.notValid('key');
            return null;
        }

        entry = this.actionMap()[key];

        if (!entry) {
            this.notValid('actionMap (' + key + ') entry');
            return null;
        }
        return this.fs.isA(entry) || [entry, ''];
    }

    /**
     * An event handler that updates the details panel as items are
     * selected in the forcesvg layer
     * @param nodeOrLink the item to display details of
     */
    nodeSelected(nodeOrLink: UiElement) {
        this.details.ngOnChanges({'selectedNode':
            new SimpleChange(undefined, nodeOrLink, true)});
    }

    /**
     * Enable traffic monitoring
     */
    monitorAllTraffic() {
        // TODO: Implement support for toggling between bits, packets and octets
        this.flashMsg = this.lionFn('tr_fl_pstats_bits');
        this.trs.init(this.force);
    }

    /**
     * Cancel traffic monitoring
     */
    cancelTraffic() {
        this.flashMsg = this.lionFn('fl_monitoring_canceled');
        this.trs.destroy();
    }

    /**
     * Read the LION bundle for Toolbar and set up the lionFn
     */
    doLion() {
        this.lionFn = this.lion.bundle('core.view.Topo');
    }

    /**
     * A dummy implementation of the lionFn until the response is received and the LION
     * bundle is received from the WebSocket
     */
    dummyLion(key: string): string {
        return '%' + key + '%';
    }
}
