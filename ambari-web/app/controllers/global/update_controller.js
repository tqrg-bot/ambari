/**
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

var App = require('app');

App.UpdateController = Em.Controller.extend({
  name: 'updateController',
  isUpdated: false,
  cluster: null,
  isWorking: false,
  updateAlertInstances: Em.computed.and('isWorking', '!App.router.mainAlertInstancesController.isUpdating'),
  timeIntervalId: null,
  clusterName: Em.computed.alias('App.router.clusterController.clusterName'),

  paginationKeys: ['page_size', 'from'],

  /**
   * @type {Array}
   */
  serviceComponentMetrics: [
    'host_components/metrics/jvm/memHeapUsedM',
    'host_components/metrics/jvm/HeapMemoryMax',
    'host_components/metrics/jvm/HeapMemoryUsed',
    'host_components/metrics/jvm/memHeapCommittedM',
    'host_components/metrics/mapred/jobtracker/trackers_decommissioned',
    'host_components/metrics/cpu/cpu_wio',
    'host_components/metrics/rpc/client/RpcQueueTime_avg_time',
    'host_components/metrics/dfs/FSNamesystem/*',
    'host_components/metrics/dfs/namenode/Version',
    'host_components/metrics/dfs/namenode/LiveNodes',
    'host_components/metrics/dfs/namenode/DeadNodes',
    'host_components/metrics/dfs/namenode/DecomNodes',
    'host_components/metrics/dfs/namenode/TotalFiles',
    'host_components/metrics/dfs/namenode/UpgradeFinalized',
    'host_components/metrics/dfs/namenode/Safemode',
    'host_components/metrics/runtime/StartTime'
  ],

  /**
   * @type {object}
   */
  serviceSpecificParams: {
    'FLUME': "host_components/processes/HostComponentProcess",
    'YARN':  "host_components/metrics/yarn/Queue," +
             "host_components/metrics/yarn/ClusterMetrics/NumActiveNMs," +
             "host_components/metrics/yarn/ClusterMetrics/NumLostNMs," +
             "host_components/metrics/yarn/ClusterMetrics/NumUnhealthyNMs," +
             "host_components/metrics/yarn/ClusterMetrics/NumRebootedNMs," +
             "host_components/metrics/yarn/ClusterMetrics/NumDecommissionedNMs",
    'HBASE': "host_components/metrics/hbase/master/IsActiveMaster," +
             "host_components/metrics/hbase/master/MasterStartTime," +
             "host_components/metrics/hbase/master/MasterActiveTime," +
             "host_components/metrics/hbase/master/AverageLoad," +
             "host_components/metrics/master/AssignmentManger/ritCount",
    'STORM': 'metrics/api/v1/cluster/summary,metrics/api/v1/topology/summary,metrics/api/v1/nimbus/summary'
  },

  /**
   * @type {string}
   */
  HOSTS_TEST_URL: '/data/hosts/HDP2/hosts.json',

  /**
   * map which track status of requests, whether it's running or completed
   * @type {object}
   */
  requestsRunningStatus: {
    "updateServiceMetric": false
  },

  getUrl: function (testUrl, url) {
    return App.get('testMode') ? testUrl : App.apiPrefix + '/clusters/' + this.get('clusterName') + url;
  },

  /**
   * construct URL from real URL and query parameters
   * @param realUrl
   * @param queryParams
   * @return {String}
   */
  getComplexUrl: function (realUrl, queryParams) {
    var prefix = App.get('apiPrefix') + '/clusters/' + App.get('clusterName'),
      params = '';

    if (queryParams) {
      params = this.computeParameters(queryParams);
    }
    params = params.length > 0 ? params + "&" : params;
    return prefix + realUrl.replace('<parameters>', params);
  },

  /**
   * compute parameters according to their type
   * @param queryParams
   * @return {String}
   */
  computeParameters: function (queryParams) {
    var params = '';

    queryParams.forEach(function (param) {
      var customKey = param.key;

      switch (param.type) {
        case 'EQUAL':
          if (Em.isArray(param.value)) {
            params += param.key + '.in(' + param.value.join(',') + ')';
          } else {
            params += param.key + '=' + param.value;
          }
          break;
        case 'LESS':
          params += param.key + '<' + param.value;
          break;
        case 'MORE':
          params += param.key + '>' + param.value;
          break;
        case 'MATCH':
          if (Em.isArray(param.value)) {
            params += '(' + param.value.map(function(v) {
              return param.key + '.matches(' + v + ')';
            }).join('|') + ')';
          } else {
            params += param.key + '.matches(' + param.value + ')';
          }
          break;
        case 'MULTIPLE':
          params += param.key + '.in(' + param.value.join(',') + ')';
          break;
        case 'SORT':
          params += 'sortBy=' + param.key + '.' + param.value;
          break;
        case 'CUSTOM':
          param.value.forEach(function (item, index) {
            customKey = customKey.replace('{' + index + '}', item);
          }, this);
          params += customKey;
          break;
        case 'COMBO':
          params += App.router.get('mainHostComboSearchBoxController').generateQueryParam(param);
          break;
      }
      params += '&';
    });
    return params.substring(0, params.length - 1);
  },

  /**
   * depict query parameters of table
   */
  queryParams: Em.Object.create({
    'Hosts': []
  }),

  /**
   * Pagination query-parameters for unhealthy alerts request
   * @type {{from: Number, page_size: Number}}
   */
  queryParamsForUnhealthyAlertInstances: {
    from: 0,
    page_size: 10
  },

  /**
   * map describes relations between updater function and table
   */
  tableUpdaterMap: {
    'Hosts': 'updateHost'
  },

  /**
   * Start polling, when <code>isWorking</code> become true
   */
  updateAll: function () {
    if (this.get('isWorking') && !App.get('isOnlyViewUser')) {
      App.StompClient.subscribe('/events/hostcomponents', App.hostComponentStatusMapper.map.bind(App.hostComponentStatusMapper));
      App.StompClient.subscribe('/events/alerts', App.alertSummaryMapper.map.bind(App.alertSummaryMapper));
      App.StompClient.subscribe('/events/ui_topologies', App.topologyMapper.map.bind(App.topologyMapper));
      App.StompClient.subscribe('/events/configs', this.makeCallForClusterEnv.bind(this));
      App.StompClient.subscribe('/events/services', App.serviceStateMapper.map.bind(App.serviceStateMapper));
      App.StompClient.subscribe('/events/hosts', App.hostStateMapper.map.bind(App.hostStateMapper));
      App.StompClient.subscribe('/events/alert_definitions', App.alertDefinitionsMapperAdapter.map.bind(App.alertDefinitionsMapperAdapter));

      App.updater.run(this, 'updateHostsMetrics', 'isWorking', App.contentUpdateInterval, '\/main\/(hosts).*');
      App.updater.run(this, 'updateServiceMetric', 'isWorking', App.componentsUpdateInterval, '\/main\/(dashboard|services).*');
      App.updater.run(this, 'updateComponentsState', 'isWorking', App.componentsUpdateInterval, '\/main\/(dashboard|services|hosts).*');
      App.updater.run(this, 'graphsUpdate', 'isWorking');
      App.updater.run(this, 'updateComponentConfig', 'isWorking');

      App.updater.run(this, 'updateAlertGroups', 'isWorking', App.alertGroupsUpdateInterval, '\/main\/alerts.*');
      if (!App.get('router.mainAlertInstancesController.isUpdating')) {
        App.updater.run(this, 'updateUnhealthyAlertInstances', 'updateAlertInstances', App.alertInstancesUpdateInterval, '\/main\/alerts.*');
      }
      App.updater.run(this, 'updateUpgradeState', 'isWorking', App.bgOperationsUpdateInterval);
      App.updater.run(this, 'updateWizardWatcher', 'isWorking', App.bgOperationsUpdateInterval);
    } else {
      App.StompClient.unsubscribe('/events/hostcomponents');
      App.StompClient.unsubscribe('/events/alerts');
      // "/events/ui_topologies" topic should listen to topology changes when wizard running
      App.StompClient.unsubscribe('/events/configs');
      App.StompClient.unsubscribe('/events/services');
      App.StompClient.unsubscribe('/events/hosts');
      App.StompClient.unsubscribe('/events/alert_definitions');
    }
  }.observes('isWorking', 'App.router.mainAlertInstancesController.isUpdating'),

  /**
   *
   * @param {Function} callback
   * @param {Function} error
   * @param {boolean} lazyLoadMetrics
   */
  updateHost: function (callback, error, lazyLoadMetrics) {
    var testUrl = this.get('HOSTS_TEST_URL'),
        self = this,
        hostDetailsFilter = '',
        realUrl = '/hosts?fields=Hosts/rack_info,Hosts/host_name,Hosts/maintenance_state,Hosts/public_host_name,Hosts/cpu_count,Hosts/ph_cpu_count,Hosts/last_agent_env,' +
            'alerts_summary,Hosts/host_status,Hosts/host_state,Hosts/last_heartbeat_time,Hosts/ip,host_components/HostRoles/state,host_components/HostRoles/maintenance_state,' +
            'host_components/HostRoles/stale_configs,host_components/HostRoles/service_name,host_components/HostRoles/display_name,host_components/HostRoles/desired_admin_state,' +
            '<metrics>Hosts/total_mem<hostDetailsParams><stackVersions>&minimal_response=true',
        hostDetailsParams = ',Hosts/os_arch,Hosts/os_type,metrics/cpu/cpu_system,metrics/cpu/cpu_user,metrics/memory/mem_total,metrics/memory/mem_free',
        stackVersionInfo = ',stack_versions/HostStackVersions,' +
            'stack_versions/repository_versions/RepositoryVersions/repository_version,stack_versions/repository_versions/RepositoryVersions/id,' +
            'stack_versions/repository_versions/RepositoryVersions/display_name',
        mainHostController = App.router.get('mainHostController'),
        sortProperties = mainHostController.getSortProps(),
        loggingResource = ',host_components/logging',
        isHostsLoaded = false,
        // load hosts metrics separately of lazyLoadMetrics=true, but metrics in current request if we are sorting
        loadMetricsSeparately = lazyLoadMetrics && !(sortProperties.length && ['loadAvg', 'diskUsage'].contains(sortProperties[0].name));
    this.get('queryParams').set('Hosts', mainHostController.getQueryParameters(true));
    if (App.router.get('currentState.parentState.name') === 'hosts') {
      App.updater.updateInterval('updateHost', App.get('contentUpdateInterval'));
      hostDetailsParams = '';
    }
    else {
      if (App.router.get('currentState.parentState.name') === 'hostDetails') {
        hostDetailsFilter = App.router.get('location.lastSetURL').match(/\/hosts\/(.*)\/(summary|configs|alerts|stackVersions|logs)/)[1];
        App.updater.updateInterval('updateHost', App.get('componentsUpdateInterval'));
        //if host details page opened then request info only of one displayed host
        this.get('queryParams').set('Hosts', [
          {
            key: 'Hosts/host_name',
            value: [hostDetailsFilter],
            type: 'MULTIPLE',
            isHostDetails: true
          }
        ]);
      }
      else {
        // On pages except for hosts/hostDetails, making sure hostsMapper loaded only once on page load, no need to update, but at least once
        isHostsLoaded = App.router.get('clusterController.isHostsLoaded');
        if (isHostsLoaded) {
          callback();
          return;
        }
      }
    }

    realUrl = realUrl.replace("<stackVersions>", stackVersionInfo);
    realUrl = realUrl.replace("<metrics>", loadMetricsSeparately ? "" : "metrics/disk,metrics/load/load_one,");
    realUrl = realUrl.replace('<hostDetailsParams>', hostDetailsParams);
    if (App.get('supports.logSearch')) {
      realUrl += loggingResource;
    }

    var clientCallback = function (skipCall, queryParams, itemTotal) {
      var completeCallback = function () {
        callback();
        if (loadMetricsSeparately) {
          self.loadHostsMetric(queryParams);
        }
      };
      if (skipCall) {
        //no hosts match filter by component
        App.hostsMapper.map({
          items: [],
          itemTotal: '0'
        });
        callback();
      }
      else {
        if (App.get('testMode')) {
          realUrl = testUrl;
        } else {
          realUrl = self.addParamsToHostsUrl(queryParams, sortProperties, realUrl);
        }

        App.HttpClient.get(realUrl, App.hostsMapper, {
          complete: completeCallback,
          beforeMap: function(response) {
            if (itemTotal) {
              response.itemTotal = itemTotal;
            }
          },
          doGetAsPost: true,
          params: self.computeParameters(queryParams),
          error: error
        });
      }
    };

    if (!this.preLoadHosts(clientCallback)) {
      clientCallback(false, self.get('queryParams.Hosts'));
    }
  },

  updateHostsMetrics: function(callback) {
    let queryParams = App.router.get('mainHostController').getQueryParameters(true);
    if (App.router.get('currentState.parentState.name') === 'hostDetails') {
      const currentHostname = App.router.get('location.lastSetURL')
        .match(/\/hosts\/(.*)\/(summary|configs|alerts|stackVersions|logs)/)[1];
      queryParams = [
        {
          key: 'Hosts/host_name',
          value: [currentHostname],
          type: 'MULTIPLE',
          isHostDetails: true
        }
      ]
    }
    this.loadHostsMetric(queryParams).always(callback);
  },

  /**
   *
   * @param {Array} queryParams
   * @param {Array} sortProperties
   * @param {string} realUrl
   * @returns {string}
   */
  addParamsToHostsUrl: function (queryParams, sortProperties, realUrl) {
    var paginationProps = this.computeParameters(queryParams.filter(function (param) {
      return this.get('paginationKeys').contains(param.key);
    }, this));
    var sortProps = this.computeParameters(sortProperties);

    return App.get('apiPrefix') + '/clusters/' + App.get('clusterName') + realUrl +
      (paginationProps.length > 0 ? '&' + paginationProps : '') +
      (sortProps.length > 0 ? '&' + sortProps : '');
  },

  /**
   * lazy load metrics of hosts
   * @param {Array} queryParams
   * @returns {$.ajax|null}
   */
  loadHostsMetric: function (queryParams) {
    var realUrl = '/hosts?fields=metrics/disk/disk_free,metrics/disk/disk_total,metrics/load/load_one&minimal_response=true';

    if (App.Service.find('AMBARI_METRICS').get('isStarted')) {
      return App.ajax.send({
        name: 'hosts.metrics.lazy_load',
        sender: this,
        data: {
          url: this.addParamsToHostsUrl(queryParams, [], realUrl),
          parameters: this.computeParameters(queryParams)
        },
        success: 'loadHostsMetricSuccessCallback'
      });
    }
    return $.Deferred().resolve().promise();
  },

  /**
   * success callback of <code>loadHostsMetric</code>
   * @param {object} data
   */
  loadHostsMetricSuccessCallback: function (data) {
    App.hostsMapper.setMetrics(data);
  },

  /**
   * identify if any filter by host-component is active
   * if so run @getHostByHostComponents
   *
   * @param callback
   * @return {Boolean}
   */
  preLoadHosts: function (callback) {
    if (this.get('queryParams.Hosts').length > 0 && this.get('queryParams.Hosts').filter(function (param) {
      return param.isComponentRelatedFilter;
    }, this).length > 0) {
      this.getHostByHostComponents(callback);
      return true;
    }
    return false;
  },

  /**
   * get hosts' names which match filter by host-component
   * @param callback
   */
  getHostByHostComponents: function (callback) {
    var realUrl = '/hosts?<parameters>minimal_response=true';

    App.ajax.send({
      name: 'hosts.host_components.pre_load',
      sender: this,
      data: {
        url: this.getComplexUrl(realUrl, this.get('queryParams.Hosts')),
        callback: callback
      },
      success: 'getHostByHostComponentsSuccessCallback',
      error: 'getHostByHostComponentsErrorCallback'
    })
  },
  getHostByHostComponentsSuccessCallback: function (data, opt, params) {
    var queryParams = this.get('queryParams.Hosts');
    var hostNames = data.items.mapProperty('Hosts.host_name');
    var skipCall = hostNames.length === 0;

    var itemTotal = parseInt(data.itemTotal, 10);
    if (!isNaN(itemTotal)) {
      App.router.set('mainHostController.filteredCount', itemTotal);
    }

    if (skipCall) {
      params.callback(skipCall);
    } else {
      queryParams = [{
        key: 'Hosts/host_name',
        value: hostNames,
        type: 'MULTIPLE'
      }];
      params.callback(skipCall, queryParams, itemTotal);
    }
  },
  getHostByHostComponentsErrorCallback: Em.K,

  graphs: [],

  graphsUpdate: function (callback) {
    var existedGraphs = [];
    this.get('graphs').forEach(function (_graph) {
      var view = Em.View.views[_graph.id];
      if (view) {
        existedGraphs.push(_graph);
        if (!view.get('isRequestRunning')) {
          //console.log('updated graph', _graph.name);
          view.loadData();
          //if graph opened as modal popup update it to
          if ($(".modal-graph-line .modal-body #" + _graph.popupId + "-container-popup").length) {
            view.loadData();
          }
        }
      }
    });
    callback();
    this.set('graphs', existedGraphs);
  },

  /**
   * Updates the services information.
   *
   * @param callback
   */
  updateServiceMetric: function (callback) {
    var self = this;
    self.set('isUpdated', false);
    var isATSPresent = App.StackServiceComponent.find().findProperty('componentName','APP_TIMELINE_SERVER');

    var conditionalFields = this.getConditionalFields(),
      requestsRunningStatus = this.get('requestsRunningStatus'),
      conditionalFieldsString = conditionalFields.length > 0 ? ',' + conditionalFields.join(',') : '',
      testUrl = '/data/dashboard/HDP2/master_components.json',
      isFlumeInstalled = App.cache.services.mapProperty('ServiceInfo.service_name').contains('FLUME'),
      isATSInstalled = App.cache.services.mapProperty('ServiceInfo.service_name').contains('YARN') && isATSPresent,
      flumeHandlerParam = isFlumeInstalled ? 'ServiceComponentInfo/component_name=FLUME_HANDLER|' : '',
      atsHandlerParam = isATSInstalled ? 'ServiceComponentInfo/component_name=APP_TIMELINE_SERVER|' : '',
      haComponents = App.get('isHaEnabled') ? 'ServiceComponentInfo/component_name=JOURNALNODE|ServiceComponentInfo/component_name=ZKFC|' : '',
      realUrl = '/components/?' + flumeHandlerParam + atsHandlerParam + haComponents +
        'ServiceComponentInfo/category=MASTER&fields=' +
        'ServiceComponentInfo/service_name,' +
        'host_components/HostRoles/display_name,' +
        'host_components/HostRoles/host_name,' +
        'host_components/HostRoles/public_host_name,' +
        'host_components/HostRoles/state,' +
        'host_components/HostRoles/maintenance_state,' +
        'host_components/HostRoles/stale_configs,' +
        'host_components/HostRoles/ha_state,' +
        'host_components/HostRoles/desired_admin_state,' +
        conditionalFieldsString +
        '&minimal_response=true';

    var servicesUrl = this.getUrl(testUrl, realUrl);
    callback = callback || function () {
      self.set('isUpdated', true);
    };

    if (!requestsRunningStatus.updateServiceMetric) {
      requestsRunningStatus.updateServiceMetric = true;
      App.HttpClient.get(servicesUrl, App.serviceMetricsMapper, {
        complete: function () {
          App.set('router.mainServiceItemController.isServicesInfoLoaded', App.get('router.clusterController.isLoaded'));
          requestsRunningStatus.updateServiceMetric = false;
          callback();
        }
      });
    } else {
      callback();
    }
  },
  /**
   * construct conditional parameters of query, depending on which services are installed
   * @return {Array}
   */
  getConditionalFields: function () {
    var conditionalFields = this.get('serviceComponentMetrics').slice(0);
    var serviceSpecificParams = $.extend({}, this.get('serviceSpecificParams'));
    var metricsKey = 'metrics/';

    if (/^2.1/.test(App.get('currentStackVersionNumber'))) {
      serviceSpecificParams.STORM = 'metrics/api/cluster/summary';
    } else if (/^2.2/.test(App.get('currentStackVersionNumber'))) {
      serviceSpecificParams.STORM = 'metrics/api/v1/cluster/summary,metrics/api/v1/topology/summary';
    }

    App.cache.services.forEach(function (service) {
      var urlParams = serviceSpecificParams[service.ServiceInfo.service_name];
      if (urlParams) {
        conditionalFields.push(urlParams);
      }
    });

    //first load shouldn't contain metrics in order to make call lighter
    if (!App.get('router.clusterController.isServiceMetricsLoaded')) {
      return conditionalFields.filter(function (condition) {
        return condition.indexOf(metricsKey) === -1;
      });
    }

    return conditionalFields;
  },

  updateServices: function (callback) {
    var testUrl = '/data/services/HDP2/services.json';
    var componentConfigUrl = this.getUrl(testUrl, '/services?fields=ServiceInfo/state,ServiceInfo/maintenance_state,ServiceInfo/desired_repository_version_id,components/ServiceComponentInfo/component_name&minimal_response=true');
    App.HttpClient.get(componentConfigUrl, App.serviceMapper, {
      complete: callback
    });
  },

  updateComponentConfig: function (callback) {
    var testUrl = '/data/services/host_component_stale_configs.json';
    var componentConfigUrl = this.getUrl(testUrl, '/components?host_components/HostRoles/stale_configs=true&fields=host_components/HostRoles/display_name,host_components/HostRoles/service_name,host_components/HostRoles/state,host_components/HostRoles/maintenance_state,host_components/HostRoles/host_name,host_components/HostRoles/public_host_name,host_components/HostRoles/stale_configs,host_components/HostRoles/desired_admin_state&minimal_response=true');
    App.HttpClient.get(componentConfigUrl, App.componentConfigMapper, {
      complete: callback
    });
  },

  updateComponentsState: function (callback) {
    var testUrl = '/data/services/HDP2/components_state.json';
    var realUrl = '/components/?fields=ServiceComponentInfo/service_name,' +
      'ServiceComponentInfo/category,ServiceComponentInfo/installed_count,ServiceComponentInfo/started_count,ServiceComponentInfo/init_count,ServiceComponentInfo/install_failed_count,ServiceComponentInfo/unknown_count,ServiceComponentInfo/total_count,ServiceComponentInfo/display_name,host_components/HostRoles/host_name&minimal_response=true';
    var url = this.getUrl(testUrl, realUrl);

    App.HttpClient.get(url, App.componentsStateMapper, {
      complete: callback
    });
  },

  updateAlertDefinitions: function (callback) {
    var testUrl = '/data/alerts/alertDefinitions.json';
    var realUrl = '/alert_definitions?fields=' +
      'AlertDefinition/component_name,AlertDefinition/description,AlertDefinition/enabled,AlertDefinition/repeat_tolerance,AlertDefinition/repeat_tolerance_enabled,' +
      'AlertDefinition/id,AlertDefinition/ignore_host,AlertDefinition/interval,AlertDefinition/label,AlertDefinition/name,' +
      'AlertDefinition/scope,AlertDefinition/service_name,AlertDefinition/source,AlertDefinition/help_url';
    var url = this.getUrl(testUrl, realUrl);

    App.HttpClient.get(url, App.alertDefinitionsMapper, {
      complete: callback
    });
  },

  updateUnhealthyAlertInstances: function (callback) {
    var testUrl = '/data/alerts/alert_instances.json';
    var queryParams = this.get('queryParamsForUnhealthyAlertInstances');
    var realUrl = '/alerts?fields=' +
      'Alert/component_name,Alert/definition_id,Alert/definition_name,Alert/host_name,Alert/id,Alert/instance,' +
      'Alert/label,Alert/latest_timestamp,Alert/maintenance_state,Alert/original_timestamp,Alert/scope,' +
      'Alert/service_name,Alert/state,Alert/text,Alert/repeat_tolerance,Alert/repeat_tolerance_remaining' +
      '&Alert/state.in(CRITICAL,WARNING)&Alert/maintenance_state.in(OFF)&from=' + queryParams.from + '&page_size=' + queryParams.page_size;
    var url = this.getUrl(testUrl, realUrl);

    App.HttpClient.get(url, App.alertInstanceMapper, {
      complete: callback
    });
  },

  updateAlertDefinitionSummary: function(callback) {
    //TODO move to clusterController
    var testUrl = '/data/alerts/alert_summary.json';
    var realUrl = '/alerts?format=groupedSummary';
    var url = this.getUrl(testUrl, realUrl);

    App.HttpClient.get(url, App.alertDefinitionSummaryMapper, {
      complete: callback
    });
  },

  updateAlertGroups: function (callback) {
    var testUrl = '/data/alerts/alertGroups.json';
    var realUrl = '/alert_groups?fields=' +
      'AlertGroup/default,AlertGroup/definitions,AlertGroup/id,AlertGroup/name,AlertGroup/targets';
    var url = this.getUrl(testUrl, realUrl);

    App.HttpClient.get(url, App.alertGroupsMapper, {
      complete: callback
    });
  },

  updateAlertNotifications: function (callback) {
    App.HttpClient.get(App.get('apiPrefix') + '/alert_targets?fields=*', App.alertNotificationMapper, {
      complete: callback
    });
  },

  updateUpgradeState: function (callback) {
    var currentStateName = App.get('router.currentState.name'),
      parentStateName = App.get('router.currentState.parentState.name'),
      mainAdminStackAndUpgradeController = App.get('router.mainAdminStackAndUpgradeController');
    if (!(currentStateName === 'versions' && parentStateName === 'stackAndUpgrade') && currentStateName !== 'stackUpgrade' && App.get('wizardIsNotFinished') && !mainAdminStackAndUpgradeController.get('isLoadUpgradeDataPending')) {
      mainAdminStackAndUpgradeController.loadUpgradeData(true).done(callback);
    } else {
      callback();
    }
  },

  makeCallForClusterEnv: function(event) {
    if (event.configs.someProperty('type', 'cluster-env')) {
      this.updateClusterEnv();
    }
  },

  //TODO - update service auto-start to use this
  updateClusterEnv: function (callback) {
    this.loadClusterConfig(callback).done(function (data) {
      var tag = [
        {
          siteName: 'cluster-env',
          tagName: data.Clusters.desired_configs['cluster-env'].tag,
          newTagName: null
        }
      ];
      App.router.get('configurationController').getConfigsByTags(tag).done(function (config) {
        App.router.get('clusterController').set('clusterEnv', config[0]);
      });
    });
  },

  loadClusterConfig: function (callback) {
    return App.ajax.send({
      name: 'config.tags.site',
      sender: this,
      data: {
        site: 'cluster-env'
      },
      callback: callback
    });
  },

  updateWizardWatcher: function(callback) {
    App.router.get('wizardWatcherController').getUser().complete(callback);
  },

  /**
   * Request to fetch logging info for specified host.
   *
   * @method updateLogging
   * @param {string} hostName
   * @param {string[]|boolean} fields additional fields to request e.g. ['field1', 'field2']
   * @param {function} callback execute on when request succeed, json response will be passed to first argument
   * @returns {$.Deferred.promise()}
   */
  updateLogging: function(hostName, fields, callback) {
    var flds = !!fields ? "," + fields.join(',') : "" ;

    return App.ajax.send({
      name: 'host.logging',
      sender: this,
      data: {
        hostName: hostName,
        callback: callback,
        fields: flds
      },
      success: 'updateLoggingSuccess'
    });
  },

  updateLoggingSuccess: function(data, opt, params) {
    var clbk = params.callback || function() {};
    clbk(data);
  }
});
